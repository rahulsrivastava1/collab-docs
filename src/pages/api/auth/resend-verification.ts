import type { NextApiRequest, NextApiResponse } from "next";
import { findUserByEmail } from "@/lib/users";
import { issueAuthCode, secondsUntilResendAllowed } from "@/lib/auth-codes";
import { sendAuthCodeEmail } from "@/lib/email";
import {
  emailOnlySchema,
  enforceRateLimit,
  parseBody,
  requestIp,
  requireSameOrigin,
} from "@/lib/api-security";

export const config = {
  api: {
    bodyParser: { sizeLimit: "4kb" },
  },
};

const GENERIC_OK = {
  ok: true,
  message: "If an unverified account exists for that email, we sent a code.",
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!requireSameOrigin(req, res)) return;
  if (
    !enforceRateLimit(res, {
      scope: "resend-verification",
      identity: requestIp(req),
      limit: 5,
      windowMs: 15 * 60_000,
    })
  )
    return;

  const body = parseBody(emailOnlySchema, req, res);
  if (!body) return;

  if (
    !enforceRateLimit(res, {
      scope: "resend-verification-email",
      identity: body.email,
      limit: 3,
      windowMs: 15 * 60_000,
    })
  )
    return;

  const user = await findUserByEmail(body.email);

  // Generic response for missing / Google-only / already verified accounts.
  if (!user?.password_hash || user.email_verified) {
    return res.status(200).json(GENERIC_OK);
  }

  const waitSec = await secondsUntilResendAllowed(user.id, "verify_email");
  if (waitSec > 0) {
    res.setHeader("Retry-After", String(waitSec));
    return res.status(429).json({
      error: `Please wait ${waitSec}s before requesting another code.`,
      retryAfterSec: waitSec,
    });
  }

  try {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not send email";
    if (message.includes("Email is not configured") || message.includes("AUTH_CODE_SECRET")) {
      return res.status(503).json({ error: message });
    }
    console.error("[resend-verification]", error);
    return res.status(500).json({ error: "Could not send verification code." });
  }

  return res.status(200).json(GENERIC_OK);
}
