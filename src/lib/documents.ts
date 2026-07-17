import { pool, query } from "@/lib/db";
import type { DocumentRole } from "@/lib/acl";

export type DocumentRow = {
  id: string;
  title: string;
  content: string;
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
  input: { title?: string; content?: string },
) {
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

  if (sets.length === 0) {
    return null;
  }

  sets.push("updated_at = NOW()");
  params.push(documentId);

  const result = await query<DocumentRow>(
    `UPDATE documents
     SET ${sets.join(", ")}
     WHERE id = $${params.length}
     RETURNING *`,
    params,
  );
  return result.rows[0] ?? null;
}

export async function deleteDocument(documentId: string) {
  await query(`DELETE FROM documents WHERE id = $1`, [documentId]);
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
}) {
  if (input.role === "owner") {
    throw new Error("Cannot assign owner via invite");
  }

  await query(
    `INSERT INTO document_members (document_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (document_id, user_id) DO UPDATE SET
       role = EXCLUDED.role,
       updated_at = NOW()`,
    [input.documentId, input.userId, input.role],
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
}) {
  const result = await query(
    `UPDATE document_members
     SET role = $3, updated_at = NOW()
     WHERE document_id = $1
       AND user_id = $2
       AND role <> 'owner'
     RETURNING user_id, role`,
    [input.documentId, input.userId, input.role],
  );
  return result.rows[0] ?? null;
}

export async function removeDocumentMember(documentId: string, userId: string) {
  const result = await query(
    `DELETE FROM document_members
     WHERE document_id = $1
       AND user_id = $2
       AND role <> 'owner'
     RETURNING user_id`,
    [documentId, userId],
  );
  return result.rowCount ?? 0;
}
