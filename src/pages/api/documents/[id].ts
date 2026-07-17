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
import { broadcast } from "@/lib/realtime-bus";
import { stateToBase64 } from "@/lib/yjs-helpers";

function serializeDocument(
  doc: {
    id: string;
    title: string;
    content: string;
    yjs_state?: Buffer | null;
    updated_at: Date | string;
    role?: string;
  },
  role: string,
) {
  const updatedAt =
    doc.updated_at instanceof Date
      ? doc.updated_at.toISOString()
      : String(doc.updated_at);

  return {
    id: doc.id,
    title: doc.title,
    content: doc.content,
    role,
    updated_at: updatedAt,
    yjs_state: stateToBase64(doc.yjs_state ?? null),
  };
}

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
    return res.status(200).json({
      document: serializeDocument(document, document.role),
    });
  }

  if (req.method === "PATCH") {
    if (!canEdit(document.role)) {
      return res.status(403).json({ error: "You do not have edit access" });
    }

    const title = typeof req.body?.title === "string" ? req.body.title : undefined;
    const content =
      typeof req.body?.content === "string" ? req.body.content : undefined;
    const yjsUpdate =
      typeof req.body?.yjsUpdate === "string" ? req.body.yjsUpdate : undefined;

    const updated = await updateDocument(id, {
      title,
      content: yjsUpdate ? undefined : content,
      yjsUpdateBase64: yjsUpdate,
    });
    const payload = updated
      ? serializeDocument(updated, document.role)
      : serializeDocument(document, document.role);

    broadcast(
      id,
      {
        type: "document_updated",
        document: {
          id: payload.id,
          title: payload.title,
          content: payload.content,
          updated_at: payload.updated_at,
          yjs_state: payload.yjs_state,
        },
      },
      user.id,
    );

    return res.status(200).json({ document: payload });
  }

  if (req.method === "DELETE") {
    if (!canDeleteDocument(document.role)) {
      return res.status(403).json({ error: "Only the owner can delete this document" });
    }
    await deleteDocument(id);
    broadcast(id, { type: "document_deleted", documentId: id }, user.id);
    return res.status(204).end();
  }

  res.setHeader("Allow", "GET, PATCH, DELETE");
  return res.status(405).json({ error: "Method not allowed" });
}
