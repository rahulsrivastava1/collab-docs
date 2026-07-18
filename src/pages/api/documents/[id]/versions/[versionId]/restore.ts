import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/api-auth";
import { canEdit, canRead } from "@/lib/acl";
import { getDocumentForUser } from "@/lib/documents";
import { restoreDocumentVersion } from "@/lib/document-versions";
import { broadcast } from "@/lib/realtime-bus";
import { stateToBase64 } from "@/lib/yjs-helpers";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const user = await requireUser(req, res);
  if (!user) return;

  const documentId = String(req.query.id ?? "");
  const versionId = String(req.query.versionId ?? "");
  const current = await getDocumentForUser(documentId, user.id);
  if (!current || !canRead(current.role)) {
    return res.status(404).json({ error: "Document not found" });
  }
  if (!canEdit(current.role)) {
    return res.status(403).json({
      error: "Only owners and editors can restore versions",
    });
  }

  const restored = await restoreDocumentVersion({
    documentId,
    versionId,
    actorId: user.id,
  });
  if (!restored) {
    return res.status(404).json({ error: "Version not found" });
  }

  const payload = {
    id: restored.document.id,
    title: restored.document.title,
    content: restored.document.content,
    role: current.role,
    updated_at: restored.document.updated_at.toISOString(),
    yjs_state: stateToBase64(restored.document.yjs_state),
    yjs_generation: restored.document.yjs_generation,
  };

  broadcast(
    documentId,
    {
      type: "document_updated",
      document: payload,
    },
    user.id,
  );

  return res.status(200).json({ document: payload });
}
