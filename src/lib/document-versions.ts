import { pool, query } from "@/lib/db";
import { createYDocFromPlainText, encodeYDocState } from "@/lib/yjs-helpers";

export type DocumentVersionRow = {
  id: string;
  document_id: string;
  title: string;
  content: string;
  yjs_state: Buffer | null;
  yjs_generation: number;
  created_by: string | null;
  restored_from_version_id: string | null;
  created_at: Date;
  author_name: string | null;
  author_email: string | null;
};

export async function listDocumentVersions(
  documentId: string,
  userId: string,
  limit = 20,
) {
  const result = await query<DocumentVersionRow>(
    `SELECT
       dv.*,
       u.name AS author_name,
       u.email AS author_email
     FROM document_versions dv
     LEFT JOIN users u ON u.id = dv.created_by
     WHERE dv.document_id = $1
       AND EXISTS (
         SELECT 1 FROM document_members dm
         WHERE dm.document_id = dv.document_id
           AND dm.user_id = $2
       )
     ORDER BY dv.created_at DESC
     LIMIT $3`,
    [documentId, userId, limit],
  );
  return result.rows;
}

/**
 * S2: at most one automatic snapshot per minute per document.
 * The advisory lock makes the throttle deterministic under concurrent saves.
 */
export async function createDocumentVersionIfDue(
  documentId: string,
  actorId: string,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [documentId]);

    const result = await client.query<DocumentVersionRow>(
      `INSERT INTO document_versions (
         document_id,
         title,
         content,
         yjs_state,
         yjs_generation,
         created_by
       )
       SELECT d.id, d.title, d.content, d.yjs_state, d.yjs_generation, $2
       FROM documents d
       WHERE d.id = $1
         AND EXISTS (
           SELECT 1 FROM document_members dm
           WHERE dm.document_id = d.id
             AND dm.user_id = $2
             AND dm.role IN ('owner', 'editor')
         )
         AND NOT EXISTS (
           SELECT 1
           FROM document_versions dv
           WHERE dv.document_id = d.id
             AND dv.created_at > NOW() - INTERVAL '1 minute'
         )
       RETURNING *`,
      [documentId, actorId],
    );

    await client.query("COMMIT");
    return result.rows[0] ?? null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function restoreDocumentVersion(input: {
  documentId: string;
  versionId: string;
  actorId: string;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      input.documentId,
    ]);

    const versionResult = await client.query<DocumentVersionRow>(
      `SELECT dv.*, u.name AS author_name, u.email AS author_email
       FROM document_versions dv
       LEFT JOIN users u ON u.id = dv.created_by
       WHERE dv.id = $1 AND dv.document_id = $2
         AND EXISTS (
           SELECT 1 FROM document_members dm
           WHERE dm.document_id = dv.document_id
             AND dm.user_id = $3
             AND dm.role IN ('owner', 'editor')
         )
       LIMIT 1`,
      [input.versionId, input.documentId, input.actorId],
    );
    const version = versionResult.rows[0];
    if (!version) {
      await client.query("ROLLBACK");
      return null;
    }

    // A restore is a new CRDT generation so stale pre-restore clients cannot
    // merge deleted content back into the restored document.
    const freshDoc = createYDocFromPlainText(version.content);
    const freshState = encodeYDocState(freshDoc);

    const documentResult = await client.query<{
      id: string;
      title: string;
      content: string;
      yjs_state: Buffer;
      yjs_generation: number;
      owner_id: string;
      created_at: Date;
      updated_at: Date;
    }>(
      `UPDATE documents
       SET title = $2,
           content = $3,
           yjs_state = $4,
           yjs_generation = yjs_generation + 1,
           updated_at = NOW()
       WHERE id = $1
         AND EXISTS (
           SELECT 1 FROM document_members dm
           WHERE dm.document_id = documents.id
             AND dm.user_id = $5
             AND dm.role IN ('owner', 'editor')
         )
       RETURNING *`,
      [
        input.documentId,
        version.title,
        version.content,
        freshState,
        input.actorId,
      ],
    );
    const document = documentResult.rows[0];
    if (!document) {
      await client.query("ROLLBACK");
      return null;
    }

    const restoredVersion = await client.query<DocumentVersionRow>(
      `INSERT INTO document_versions (
         document_id,
         title,
         content,
         yjs_state,
         yjs_generation,
         created_by,
         restored_from_version_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        document.id,
        document.title,
        document.content,
        document.yjs_state,
        document.yjs_generation,
        input.actorId,
        version.id,
      ],
    );

    await client.query("COMMIT");
    return { document, version: restoredVersion.rows[0] };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
