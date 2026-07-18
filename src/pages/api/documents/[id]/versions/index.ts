import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/api-auth";
import { canRead } from "@/lib/acl";
import { getDocumentForUser } from "@/lib/documents";
import { listDocumentVersions } from "@/lib/document-versions";
import { parseUuidParam } from "@/lib/api-security";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const user = await requireUser(req, res);
  if (!user) return;

  const documentId = parseUuidParam(req.query.id, "Document id", res);
  if (!documentId) return;
  const document = await getDocumentForUser(documentId, user.id);
  if (!document || !canRead(document.role)) {
    return res.status(404).json({ error: "Document not found" });
  }

  const rows = await listDocumentVersions(documentId, user.id);
  const versions = rows.map((version) => ({
    id: version.id,
    title: version.title,
    content: version.content,
    created_at: version.created_at.toISOString(),
    author_name: version.author_name,
    author_email: version.author_email,
    restored_from_version_id: version.restored_from_version_id,
  }));

  return res.status(200).json({ versions });
}
