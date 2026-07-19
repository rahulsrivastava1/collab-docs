import type { NextApiRequest, NextApiResponse } from "next";
import bcrypt from "bcryptjs";
import { findUserByEmail, updatePasswordHash } from "@/lib/users";
import { invalidateActiveCodes, verifyAndConsumeAuthCode } from "@/lib/auth-codes";
import {
  enforceRateLimit,
  parseBody,
  requestIp,
  requireSameOrigin,
  resetPasswordSchema,
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
      scope: "reset-password",
      identity: requestIp(req),
      limit: 20,
      windowMs: 15 * 60_000,
    })
  )
    return;

  const body = parseBody(resetPasswordSchema, req, res);
  if (!body) return;

  if (
    !enforceRateLimit(res, {
      scope: "reset-password-email",
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

  const result = await verifyAndConsumeAuthCode({
    userId: user.id,
    email: user.email,
    purpose: "reset_password",
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

  const passwordHash = await bcrypt.hash(body.password, 12);
  const updated = await updatePasswordHash(user.id, passwordHash);
  if (!updated) {
    return res.status(400).json({ error: "Invalid or expired code." });
  }

  await invalidateActiveCodes(user.id, "reset_password");
  await invalidateActiveCodes(user.id, "verify_email");

  return res.status(200).json({
    ok: true,
    message: "Password updated. You can sign in.",
  });
}
