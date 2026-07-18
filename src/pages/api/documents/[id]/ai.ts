import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/api-auth";
import { canEdit, canRead } from "@/lib/acl";
import { getDocumentForUser } from "@/lib/documents";
import { runDocumentAi } from "@/lib/ai";
import {
  documentAiSchema,
  enforceRateLimit,
  parseBody,
  parseUuidParam,
  requireSameOrigin,
} from "@/lib/api-security";

export const config = {
  api: {
    bodyParser: { sizeLimit: "2kb" },
  },
};

const configuredMinutes = Number(process.env.AI_RATE_LIMIT_MINUTES ?? "5");
const AI_RATE_LIMIT_MINUTES =
  Number.isFinite(configuredMinutes) && configuredMinutes > 0
    ? Math.min(configuredMinutes, 24 * 60)
    : 5;
const AI_WINDOW_MS = AI_RATE_LIMIT_MINUTES * 60_000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const user = await requireUser(req, res);
  if (!user) return;

  if (!requireSameOrigin(req, res)) return;

  const documentId = parseUuidParam(req.query.id, "Document id", res);
  if (!documentId) return;

  const body = parseBody(documentAiSchema, req, res);
  if (!body) return;

  const document = await getDocumentForUser(documentId, user.id);
  if (!document || !canRead(document.role)) {
    return res.status(404).json({ error: "Document not found" });
  }

  if (body.action !== "summarize" && !canEdit(document.role)) {
    return res.status(403).json({
      error: "Only owners and editors can use this AI action",
    });
  }

  const content = (document.content ?? "").trim();
  if (!content) {
    return res.status(400).json({
      error: "Nothing to process — add some text first",
    });
  }

  if (
    !enforceRateLimit(res, {
      scope: `ai:${body.action}`,
      identity: user.id,
      limit: 1,
      windowMs: AI_WINDOW_MS,
    })
  ) {
    return;
  }

  try {
    const result = await runDocumentAi(body.action, content);
    return res.status(200).json({
      action: body.action,
      result,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "AI request failed";
    const status = message.includes("not configured") ? 503 : 502;
    return res.status(status).json({ error: message });
  }
}
