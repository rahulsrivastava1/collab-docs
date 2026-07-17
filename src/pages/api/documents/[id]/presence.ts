import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/api-auth";
import { canEdit, canRead } from "@/lib/acl";
import { getDocumentForUser } from "@/lib/documents";
import {
  getPresenceSnapshot,
  setPresence,
  type PresenceMode,
} from "@/lib/realtime-bus";

function displayNameFor(user: { name?: string | null; email?: string | null }) {
  return user.name?.trim() || user.email?.split("@")[0]?.trim() || null;
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
    return res.status(200).json({ peers: getPresenceSnapshot(id) });
  }

  if (req.method === "POST") {
    const rawMode = req.body?.mode;
    let mode: PresenceMode = "viewing";
    if (rawMode === "editing" || rawMode === "viewing") {
      mode = rawMode;
    }

    if (mode === "editing" && !canEdit(document.role)) {
      mode = "viewing";
    }

    const caret =
      typeof req.body?.caret === "number" && Number.isFinite(req.body.caret)
        ? Math.max(0, Math.floor(req.body.caret))
        : null;

    const peers = setPresence(id, {
      userId: user.id,
      name: displayNameFor(user),
      image: user.image ?? null,
      mode,
      caret: mode === "editing" ? caret : null,
    });

    return res.status(200).json({ peers });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}
