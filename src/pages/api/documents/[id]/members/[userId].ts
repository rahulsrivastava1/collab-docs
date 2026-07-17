import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/api-auth";
import { canManageSharing, canRead, isDocumentRole } from "@/lib/acl";
import {
  getDocumentForUser,
  removeDocumentMember,
  updateMemberRole,
} from "@/lib/documents";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireUser(req, res);
  if (!user) return;

  const documentId = String(req.query.id ?? "");
  const memberUserId = String(req.query.userId ?? "");

  if (!documentId || !memberUserId) {
    return res.status(400).json({ error: "Document id and member id are required" });
  }

  const document = await getDocumentForUser(documentId, user.id);
  if (!document || !canRead(document.role)) {
    return res.status(404).json({ error: "Document not found" });
  }

  if (!canManageSharing(document.role)) {
    return res.status(403).json({ error: "Only the owner can manage members" });
  }

  if (req.method === "PATCH") {
    const role = req.body?.role;
    if (!isDocumentRole(role) || role === "owner") {
      return res.status(400).json({ error: "Role must be editor or viewer" });
    }

    const updated = await updateMemberRole({
      documentId,
      userId: memberUserId,
      role,
    });

    if (!updated) {
      return res.status(404).json({ error: "Member not found or is the owner" });
    }

    return res.status(200).json({ member: updated });
  }

  if (req.method === "DELETE") {
    const removed = await removeDocumentMember(documentId, memberUserId);
    if (!removed) {
      return res.status(404).json({ error: "Member not found or is the owner" });
    }
    return res.status(204).end();
  }

  res.setHeader("Allow", "PATCH, DELETE");
  return res.status(405).json({ error: "Method not allowed" });
}
