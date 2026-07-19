import type { NextApiRequest, NextApiResponse } from "next";
import bcrypt from "bcryptjs";
import { createUser, findUserByEmail } from "@/lib/users";
import { issueAuthCode } from "@/lib/auth-codes";
import { sendAuthCodeEmail } from "@/lib/email";
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
  )
    return;

  const body = parseBody(registerSchema, req, res);
  if (!body) return;

  if (
    !enforceRateLimit(res, {
      scope: "register-email",
      identity: body.email,
      limit: 3,
      windowMs: 15 * 60_000,
    })
  )
    return;

  const existing = await findUserByEmail(body.email);
  if (existing) {
    return res.status(409).json({
      error: "An account with this email already exists. Please sign in instead.",
    });
  }

  try {
    const passwordHash = await bcrypt.hash(body.password, 12);
    const user = await createUser({
      name: body.name || null,
      email: body.email,
      passwordHash,
      emailVerified: null,
    });

    const { code } = await issueAuthCode({
      userId: user.id,
      email: user.email,
      purpose: "verify_email",
    });

    await sendAuthCodeEmail({
      to: user.email,
      purpose: "verify_email",
      code,
    });

    return res.status(201).json({
      ok: true,
      email: user.email,
      message: "Check your email for a verification code.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create account";
    if (message.includes("Email is not configured") || message.includes("AUTH_CODE_SECRET")) {
      return res.status(503).json({ error: message });
    }
    // Unique email race
    if (typeof message === "string" && message.includes("users_email")) {
      return res.status(409).json({
        error: "An account with this email already exists. Please sign in instead.",
      });
    }
    console.error("[register]", error);
    return res.status(500).json({ error: "Could not create account." });
  }
}
