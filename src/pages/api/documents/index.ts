import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/api-auth";
import { createDocument, listDocumentsForUser } from "@/lib/documents";
import { createDocumentVersionIfDue } from "@/lib/document-versions";
import {
  createDocumentSchema,
  enforceRateLimit,
  parseBody,
  requireSameOrigin,
} from "@/lib/api-security";

export const config = {
  api: {
    bodyParser: { sizeLimit: "8kb" },
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireUser(req, res);
  if (!user) return;

  if (req.method === "GET") {
    const documents = await listDocumentsForUser(user.id);
    return res.status(200).json({ documents });
  }

  if (req.method === "POST") {
    if (!requireSameOrigin(req, res)) return;
    if (
      !enforceRateLimit(res, {
        scope: "create-document",
        identity: user.id,
        limit: 20,
        windowMs: 60_000,
      })
    ) return;

    const body = parseBody(createDocumentSchema, req, res);
    if (!body) return;
    const title = body.title ?? "Untitled document";
    const doc = await createDocument({ ownerId: user.id, title });
    await createDocumentVersionIfDue(doc.id, user.id);
    return res.status(201).json({ document: doc });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}
