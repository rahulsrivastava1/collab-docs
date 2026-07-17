import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/api-auth";
import {
  canManageSharing,
  canRead,
  isDocumentRole,
  type DocumentRole,
} from "@/lib/acl";
import {
  getDocumentForUser,
  listDocumentMembers,
  upsertDocumentMember,
} from "@/lib/documents";
import { findUserByEmail } from "@/lib/users";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const user = await requireUser(req, res);
    if (!user) return;

    const documentId = String(req.query.id ?? "");
    if (!documentId) {
      res.status(400).json({ error: "Document id is required" });
      return;
    }

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

      const email =
        typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      const role = req.body?.role as DocumentRole;

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        res.status(400).json({ error: "A valid email is required" });
        return;
      }

      if (!isDocumentRole(role) || role === "owner") {
        res.status(400).json({ error: "Role must be editor or viewer" });
        return;
      }

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
