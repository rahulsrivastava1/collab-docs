import type { NextApiRequest, NextApiResponse } from "next";
import { requireUser } from "@/lib/api-auth";
import { createDocument, listDocumentsForUser } from "@/lib/documents";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireUser(req, res);
  if (!user) return;

  if (req.method === "GET") {
    const documents = await listDocumentsForUser(user.id);
    return res.status(200).json({ documents });
  }

  if (req.method === "POST") {
    const title =
      typeof req.body?.title === "string" ? req.body.title : "Untitled document";
    const doc = await createDocument({ ownerId: user.id, title });
    return res.status(201).json({ document: doc });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}
