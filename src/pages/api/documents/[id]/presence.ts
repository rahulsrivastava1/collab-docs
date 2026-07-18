import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/api-auth";
import { canEdit, canRead } from "@/lib/acl";
import { getDocumentForUser } from "@/lib/documents";
import {
  getPresenceSnapshot,
  setPresence,
} from "@/lib/realtime-bus";
import {
  enforceRateLimit,
  parseBody,
  parseUuidParam,
  presenceSchema,
  requireSameOrigin,
} from "@/lib/api-security";

export const config = {
  api: {
    bodyParser: { sizeLimit: "2kb" },
  },
};

function displayNameFor(user: { name?: string | null; email?: string | null }) {
  return user.name?.trim() || user.email?.split("@")[0]?.trim() || null;
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
    return res.status(200).json({ peers: getPresenceSnapshot(id) });
  }

  if (req.method === "POST") {
    if (!requireSameOrigin(req, res)) return;
    if (
      !enforceRateLimit(res, {
        scope: `presence:${id}`,
        identity: user.id,
        limit: 180,
        windowMs: 60_000,
      })
    ) return;

    const body = parseBody(presenceSchema, req, res);
    if (!body) return;

    const mode = body.mode === "editing" && !canEdit(document.role)
      ? "viewing"
      : body.mode;
    const caret = body.caret ?? null;

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
