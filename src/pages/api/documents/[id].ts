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
import { createDocumentVersionIfDue } from "@/lib/document-versions";
import { stateToBase64 } from "@/lib/yjs-helpers";
import {
  enforceRateLimit,
  parseBody,
  parseUuidParam,
  requireSameOrigin,
  updateDocumentSchema,
} from "@/lib/api-security";

export const config = {
  api: {
    bodyParser: { sizeLimit: "768kb" },
    responseLimit: "2mb",
  },
};

function serializeDocument(
  doc: {
    id: string;
    title: string;
    content: string;
    yjs_state?: Buffer | null;
    yjs_generation?: number;
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
    yjs_generation: doc.yjs_generation ?? 1,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireUser(req, res);
  if (!user) return;

  const id = parseUuidParam(req.query.id, "Document id", res);
  if (!id) return;

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

    if (!requireSameOrigin(req, res)) return;
    if (
      !enforceRateLimit(res, {
        scope: `update-document:${id}`,
        identity: user.id,
        limit: 120,
        windowMs: 60_000,
      })
    ) return;

    const body = parseBody(updateDocumentSchema, req, res);
    if (!body) return;
    const { title, content, yjsUpdate } = body;
    const touchesContent = content !== undefined || yjsUpdate !== undefined;

    if (
      touchesContent &&
      body.yjsGeneration !== document.yjs_generation
    ) {
      return res.status(409).json({
        error: "Document was restored. Refresh before syncing older edits.",
        document: serializeDocument(document, document.role),
      });
    }

    let updated;
    try {
      updated = await updateDocument(id, user.id, {
        title,
        content: yjsUpdate ? undefined : content,
        yjsUpdateBase64: yjsUpdate,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid document update";
      if (
        message.includes("exceeds") ||
        message.includes("Yjs update") ||
        message.includes("Document content")
      ) {
        return res.status(413).json({ error: message });
      }
      throw error;
    }
    const payload = updated
      ? serializeDocument(updated, document.role)
      : serializeDocument(document, document.role);

    if (updated) {
      await createDocumentVersionIfDue(id, user.id);
    }

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
          yjs_generation: payload.yjs_generation,
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
    if (!requireSameOrigin(req, res)) return;
    if (
      !enforceRateLimit(res, {
        scope: "delete-document",
        identity: user.id,
        limit: 10,
        windowMs: 60_000,
      })
    ) return;
    await deleteDocument(id, user.id);
    broadcast(id, { type: "document_deleted", documentId: id }, user.id);
    return res.status(204).end();
  }

  res.setHeader("Allow", "GET, PATCH, DELETE");
  return res.status(405).json({ error: "Method not allowed" });
}
