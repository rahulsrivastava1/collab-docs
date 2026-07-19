import type { NextApiRequest, NextApiResponse } from "next";
import { findUserByEmail, markEmailVerified } from "@/lib/users";
import { verifyAndConsumeAuthCode } from "@/lib/auth-codes";
import {
  enforceRateLimit,
  parseBody,
  requestIp,
  requireSameOrigin,
  verifyEmailSchema,
} from "@/lib/api-security";

export const config = {
  api: {
    bodyParser: { sizeLimit: "4kb" },
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
      scope: "verify-email",
      identity: requestIp(req),
      limit: 20,
      windowMs: 15 * 60_000,
    })
  )
    return;

  const body = parseBody(verifyEmailSchema, req, res);
  if (!body) return;

  if (
    !enforceRateLimit(res, {
      scope: "verify-email-account",
      identity: body.email,
      limit: 10,
      windowMs: 15 * 60_000,
    })
  )
    return;

  const user = await findUserByEmail(body.email);
  if (!user?.password_hash) {
    return res.status(400).json({ error: "Invalid or expired code." });
  }

  if (user.email_verified) {
    return res.status(200).json({ ok: true, message: "Email already verified." });
  }

  const result = await verifyAndConsumeAuthCode({
    userId: user.id,
    email: user.email,
    purpose: "verify_email",
    code: body.code,
  });

  if (!result.ok) {
    const message =
      result.reason === "locked"
        ? "Too many attempts. Request a new code."
        : result.reason === "expired"
          ? "Code expired. Request a new one."
          : "Invalid or expired code.";
    return res.status(400).json({ error: message });
  }

  await markEmailVerified(user.id);
  return res.status(200).json({ ok: true, message: "Email verified. You can sign in." });
}
