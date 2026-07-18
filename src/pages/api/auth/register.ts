import type { NextApiRequest, NextApiResponse } from "next";
import bcrypt from "bcryptjs";
import { createUser, findUserByEmail } from "@/lib/users";
import {
  enforceRateLimit,
  parseBody,
  registerSchema,
  requestIp,
  requireSameOrigin,
} from "@/lib/api-security";

export const config = {
  api: {
    bodyParser: { sizeLimit: "8kb" },
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!requireSameOrigin(req, res)) return;
  if (
    !enforceRateLimit(res, {
      scope: "register",
      identity: requestIp(req),
      limit: 5,
      windowMs: 15 * 60_000,
    })
  ) return;

  const body = parseBody(registerSchema, req, res);
  if (!body) return;

  const existing = await findUserByEmail(body.email);
  if (existing) {
    return res.status(409).json({ error: "An account with this email already exists." });
  }

  const passwordHash = await bcrypt.hash(body.password, 12);
  const user = await createUser({
    name: body.name || null,
    email: body.email,
    passwordHash,
  });

  return res.status(201).json({
    id: user.id,
    email: user.email,
    name: user.name,
  });
}
