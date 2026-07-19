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
  message: "If an account exists for that email, we sent a reset code.",
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!requireSameOrigin(req, res)) return;
  if (
    !enforceRateLimit(res, {
      scope: "forgot-password",
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
      scope: "forgot-password-email",
      identity: body.email,
      limit: 3,
      windowMs: 15 * 60_000,
    })
  )
    return;

  const user = await findUserByEmail(body.email);

  // Google-only and unknown emails: same response, no email sent.
  if (!user?.password_hash) {
    return res.status(200).json(GENERIC_OK);
  }

  // Only send reset codes for verified password accounts.
  if (!user.email_verified) {
    return res.status(200).json(GENERIC_OK);
  }

  const waitSec = await secondsUntilResendAllowed(user.id, "reset_password");
  if (waitSec > 0) {
    // Still return generic OK to avoid leaking cooldown for known accounts,
    // but include Retry-After for honest clients that just requested a code.
    res.setHeader("Retry-After", String(waitSec));
    return res.status(200).json({
      ...GENERIC_OK,
      retryAfterSec: waitSec,
    });
  }

  try {
    const { code } = await issueAuthCode({
      userId: user.id,
      email: user.email,
      purpose: "reset_password",
    });
    await sendAuthCodeEmail({
      to: user.email,
      purpose: "reset_password",
      code,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not send email";
    if (message.includes("Email is not configured") || message.includes("AUTH_CODE_SECRET")) {
      return res.status(503).json({ error: message });
    }
    console.error("[forgot-password]", error);
    // Still generic to the client when possible
    return res.status(200).json(GENERIC_OK);
  }

  return res.status(200).json(GENERIC_OK);
}
