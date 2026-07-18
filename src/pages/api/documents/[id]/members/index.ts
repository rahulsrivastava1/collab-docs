import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/api-auth";
import {
  canManageSharing,
  canRead,
} from "@/lib/acl";
import {
  getDocumentForUser,
  listDocumentMembers,
  upsertDocumentMember,
} from "@/lib/documents";
import { findUserByEmail } from "@/lib/users";
import {
  enforceRateLimit,
  inviteMemberSchema,
  parseBody,
  parseUuidParam,
  requireSameOrigin,
} from "@/lib/api-security";

export const config = {
  api: {
    bodyParser: { sizeLimit: "4kb" },
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const documentId = parseUuidParam(req.query.id, "Document id", res);
    if (!documentId) return;

    const document = await getDocumentForUser(documentId, user.id);
    if (!document || !canRead(document.role)) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    if (req.method === "GET") {
      const members = await listDocumentMembers(documentId);
      res.status(200).json({ members });
      return;
    }

    if (req.method === "POST") {
      if (!canManageSharing(document.role)) {
        res.status(403).json({ error: "Only the owner can share this document" });
        return;
      }
      if (!requireSameOrigin(req, res)) return;
      if (
        !enforceRateLimit(res, {
          scope: `invite-member:${documentId}`,
          identity: user.id,
          limit: 30,
          windowMs: 60_000,
        })
      ) return;

      const body = parseBody(inviteMemberSchema, req, res);
      if (!body) return;
      const { email, role } = body;

      const invitee = await findUserByEmail(email);
      if (!invitee) {
        res.status(404).json({
          error: "No account found for that email. They must register first.",
        });
        return;
      }

      if (invitee.id === user.id) {
        res.status(400).json({ error: "You already own this document" });
        return;
      }

      const existing = await getDocumentForUser(documentId, invitee.id);
      if (existing?.role === "owner") {
        res.status(400).json({ error: "Cannot change the owner via invite" });
        return;
      }

      const member = await upsertDocumentMember({
        documentId,
        userId: invitee.id,
        role,
        actorId: user.id,
      });

      res.status(200).json({ member });
      return;
    }

    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("[members API]", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Something went wrong while sharing" });
    }
  }
}
