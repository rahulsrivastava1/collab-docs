import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/api-auth";
import { canManageSharing, canRead } from "@/lib/acl";
import {
  getDocumentForUser,
  removeDocumentMember,
  updateMemberRole,
} from "@/lib/documents";
import {
  enforceRateLimit,
  parseBody,
  parseUuidParam,
  requireSameOrigin,
  updateMemberSchema,
} from "@/lib/api-security";

export const config = {
  api: {
    bodyParser: { sizeLimit: "2kb" },
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireUser(req, res);
  if (!user) return;

  const documentId = parseUuidParam(req.query.id, "Document id", res);
  if (!documentId) return;
  const memberUserId = parseUuidParam(req.query.userId, "Member id", res);
  if (!memberUserId) return;

  const document = await getDocumentForUser(documentId, user.id);
  if (!document || !canRead(document.role)) {
    return res.status(404).json({ error: "Document not found" });
  }

  if (!canManageSharing(document.role)) {
    return res.status(403).json({ error: "Only the owner can manage members" });
  }
  if (!requireSameOrigin(req, res)) return;
  if (
    !enforceRateLimit(res, {
      scope: `manage-member:${documentId}`,
      identity: user.id,
      limit: 30,
      windowMs: 60_000,
    })
  ) return;

  if (req.method === "PATCH") {
    const body = parseBody(updateMemberSchema, req, res);
    if (!body) return;

    const updated = await updateMemberRole({
      documentId,
      userId: memberUserId,
      role: body.role,
      actorId: user.id,
    });

    if (!updated) {
      return res.status(404).json({ error: "Member not found or is the owner" });
    }

    return res.status(200).json({ member: updated });
  }

  if (req.method === "DELETE") {
    const removed = await removeDocumentMember(documentId, memberUserId, user.id);
    if (!removed) {
      return res.status(404).json({ error: "Member not found or is the owner" });
    }
    return res.status(204).end();
  }

  res.setHeader("Allow", "PATCH, DELETE");
  return res.status(405).json({ error: "Method not allowed" });
}
