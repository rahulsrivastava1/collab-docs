import { pool, query } from "@/lib/db";
import type { DocumentRole } from "@/lib/acl";

export type DocumentRow = {
  id: string;
  title: string;
  content: string;
  yjs_state: Buffer | null;
  yjs_generation: number;
  owner_id: string;
  created_at: Date;
  updated_at: Date;
};

export type DocumentListItem = {
  id: string;
  title: string;
  updated_at: Date;
  role: DocumentRole;
  owner_name: string | null;
  owner_email: string;
};

export type DocumentMemberRow = {
  user_id: string;
  role: DocumentRole;
  name: string | null;
  email: string;
  image: string | null;
};

export async function listDocumentsForUser(userId: string) {
  const result = await query<DocumentListItem>(
    `SELECT
       d.id,
       d.title,
       d.updated_at,
       dm.role,
       u.name AS owner_name,
       u.email AS owner_email
     FROM document_members dm
     JOIN documents d ON d.id = dm.document_id
     JOIN users u ON u.id = d.owner_id
     WHERE dm.user_id = $1
     ORDER BY d.updated_at DESC`,
    [userId],
  );
  return result.rows;
}

export async function getDocumentForUser(documentId: string, userId: string) {
  const result = await query<DocumentRow & { role: DocumentRole }>(
    `SELECT d.*, dm.role
     FROM documents d
     JOIN document_members dm ON dm.document_id = d.id
     WHERE d.id = $1 AND dm.user_id = $2
     LIMIT 1`,
    [documentId, userId],
  );
  return result.rows[0] ?? null;
}

export async function createDocument(input: {
  ownerId: string;
  title?: string;
  content?: string;
}) {
  const title = input.title?.trim() || "Untitled document";
  const content = input.content ?? "";

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const docResult = await client.query<DocumentRow>(
      `INSERT INTO documents (title, content, owner_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [title, content, input.ownerId],
    );
    const doc = docResult.rows[0];

    await client.query(
      `INSERT INTO document_members (document_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [doc.id, input.ownerId],
    );

    await client.query("COMMIT");
    return { ...doc, role: "owner" as const };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateDocument(
  documentId: string,
  actorId: string,
  input: {
    title?: string;
    content?: string;
    yjsUpdateBase64?: string;
    yjsState?: Buffer | null;
  },
) {
  // Prefer CRDT update path when provided
  if (typeof input.yjsUpdateBase64 === "string" && input.yjsUpdateBase64) {
    const { applyYjsUpdateToState, createYDocFromPlainText, encodeYDocState } = await import(
      "@/lib/yjs-helpers"
    );
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Serialize concurrent CRDT merges so no update can overwrite another.
      const current = await client.query<DocumentRow>(
        `SELECT d.*
         FROM documents d
         JOIN document_members dm ON dm.document_id = d.id
         WHERE d.id = $1
           AND dm.user_id = $2
           AND dm.role IN ('owner', 'editor')
         FOR UPDATE OF d`,
        [documentId, actorId],
      );
      const row = current.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return null;
      }

      let state = row.yjs_state;
      if (!state || state.length === 0) {
        const boot = createYDocFromPlainText(row.content ?? "");
        state = encodeYDocState(boot);
      }

      const merged = applyYjsUpdateToState(
        state,
        input.yjsUpdateBase64,
        row.content ?? "",
      );

      const title =
        typeof input.title === "string"
          ? input.title.trim() || "Untitled document"
          : undefined;

      const result = await client.query<DocumentRow>(
        title
          ? `UPDATE documents
             SET title = $1,
                 content = $2,
                 yjs_state = $3,
                 updated_at = NOW()
             WHERE id = $4
             RETURNING *`
          : `UPDATE documents
             SET content = $1,
                 yjs_state = $2,
                 updated_at = NOW()
             WHERE id = $3
             RETURNING *`,
        title
          ? [title, merged.content, merged.state, documentId]
          : [merged.content, merged.state, documentId],
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

  const sets: string[] = [];
  const params: unknown[] = [];

  if (typeof input.title === "string") {
    params.push(input.title.trim() || "Untitled document");
    sets.push(`title = $${params.length}`);
  }
  if (typeof input.content === "string") {
    params.push(input.content);
    sets.push(`content = $${params.length}`);
  }
  if (input.yjsState !== undefined) {
    params.push(input.yjsState);
    sets.push(`yjs_state = $${params.length}`);
  }

  if (sets.length === 0) {
    return null;
  }

  sets.push("updated_at = NOW()");
  params.push(documentId);
  const documentIdParam = params.length;
  params.push(actorId);
  const actorIdParam = params.length;

  const result = await query<DocumentRow>(
    `UPDATE documents
     SET ${sets.join(", ")}
     WHERE id = $${documentIdParam}
       AND EXISTS (
         SELECT 1
         FROM document_members dm
         WHERE dm.document_id = documents.id
           AND dm.user_id = $${actorIdParam}
           AND dm.role IN ('owner', 'editor')
       )
     RETURNING *`,
    params,
  );
  return result.rows[0] ?? null;
}

export async function deleteDocument(documentId: string, actorId: string) {
  await query(
    `DELETE FROM documents d
     WHERE d.id = $1
       AND EXISTS (
         SELECT 1
         FROM document_members dm
         WHERE dm.document_id = d.id
           AND dm.user_id = $2
           AND dm.role = 'owner'
       )`,
    [documentId, actorId],
  );
}

export async function listDocumentMembers(documentId: string) {
  const result = await query<DocumentMemberRow>(
    `SELECT dm.user_id, dm.role, u.name, u.email, u.image
     FROM document_members dm
     JOIN users u ON u.id = dm.user_id
     WHERE dm.document_id = $1
     ORDER BY
       CASE dm.role
         WHEN 'owner' THEN 0
         WHEN 'editor' THEN 1
         ELSE 2
       END,
       u.email ASC`,
    [documentId],
  );
  return result.rows;
}

export async function upsertDocumentMember(input: {
  documentId: string;
  userId: string;
  role: DocumentRole;
  actorId: string;
}) {
  if (input.role === "owner") {
    throw new Error("Cannot assign owner via invite");
  }

  await query(
    `INSERT INTO document_members (document_id, user_id, role)
     SELECT $1, $2, $3
     WHERE EXISTS (
       SELECT 1 FROM document_members owner_membership
       WHERE owner_membership.document_id = $1
         AND owner_membership.user_id = $4
         AND owner_membership.role = 'owner'
     )
     ON CONFLICT (document_id, user_id) DO UPDATE SET
       role = EXCLUDED.role,
       updated_at = NOW()`,
    [input.documentId, input.userId, input.role, input.actorId],
  );

  const result = await query<DocumentMemberRow>(
    `SELECT dm.user_id, dm.role, u.name, u.email, u.image
     FROM document_members dm
     JOIN users u ON u.id = dm.user_id
     WHERE dm.document_id = $1 AND dm.user_id = $2
     LIMIT 1`,
    [input.documentId, input.userId],
  );

  return result.rows[0];
}

export async function updateMemberRole(input: {
  documentId: string;
  userId: string;
  role: Exclude<DocumentRole, "owner">;
  actorId: string;
}) {
  const result = await query(
    `UPDATE document_members
     SET role = $3, updated_at = NOW()
     WHERE document_id = $1
       AND user_id = $2
       AND role <> 'owner'
       AND EXISTS (
         SELECT 1 FROM document_members owner_membership
         WHERE owner_membership.document_id = $1
           AND owner_membership.user_id = $4
           AND owner_membership.role = 'owner'
       )
     RETURNING user_id, role`,
    [input.documentId, input.userId, input.role, input.actorId],
  );
  return result.rows[0] ?? null;
}

export async function removeDocumentMember(
  documentId: string,
  userId: string,
  actorId: string,
) {
  const result = await query(
    `DELETE FROM document_members
     WHERE document_id = $1
       AND user_id = $2
       AND role <> 'owner'
       AND EXISTS (
         SELECT 1 FROM document_members owner_membership
         WHERE owner_membership.document_id = $1
           AND owner_membership.user_id = $3
           AND owner_membership.role = 'owner'
       )
     RETURNING user_id`,
    [documentId, userId, actorId],
  );
  return result.rowCount ?? 0;
}
