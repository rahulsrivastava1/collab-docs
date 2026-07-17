import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/api-auth";
import {
  canDeleteDocument,
  canEdit,
  canRead,
} from "@/lib/acl";
import {
  deleteDocument,
  getDocumentForUser,
  updateDocument,
} from "@/lib/documents";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireUser(req, res);
  if (!user) return;

  const id = String(req.query.id ?? "");
  if (!id) {
    return res.status(400).json({ error: "Document id is required" });
  }

  const document = await getDocumentForUser(id, user.id);
  if (!document || !canRead(document.role)) {
    return res.status(404).json({ error: "Document not found" });
  }

  if (req.method === "GET") {
    return res.status(200).json({ document });
  }

  if (req.method === "PATCH") {
    if (!canEdit(document.role)) {
      return res.status(403).json({ error: "You do not have edit access" });
    }

    const title = typeof req.body?.title === "string" ? req.body.title : undefined;
    const content =
      typeof req.body?.content === "string" ? req.body.content : undefined;

    const updated = await updateDocument(id, { title, content });
    return res.status(200).json({
      document: updated ? { ...updated, role: document.role } : document,
    });
  }

  if (req.method === "DELETE") {
    if (!canDeleteDocument(document.role)) {
      return res.status(403).json({ error: "Only the owner can delete this document" });
    }
    await deleteDocument(id);
    return res.status(204).end();
  }

  res.setHeader("Allow", "GET, PATCH, DELETE");
  return res.status(405).json({ error: "Method not allowed" });
}
