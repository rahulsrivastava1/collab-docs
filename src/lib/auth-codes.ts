import { createHmac, randomInt, timingSafeEqual } from "crypto";
import { query } from "@/lib/db";

export type AuthCodePurpose = "verify_email" | "reset_password";

const CODE_TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60_000;

type AuthCodeRow = {
  id: string;
  user_id: string;
  purpose: AuthCodePurpose;
  code_hash: string;
  attempts: number;
  max_attempts: number;
  expires_at: Date;
  consumed_at: Date | null;
  created_at: Date;
};

function pepper() {
  return (
    process.env.AUTH_CODE_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim() ||
    ""
  );
}

export function hashAuthCode(
  purpose: AuthCodePurpose,
  email: string,
  code: string,
) {
  const secret = pepper();
  if (!secret) {
    throw new Error("AUTH_CODE_SECRET or NEXTAUTH_SECRET must be set");
  }
  return createHmac("sha256", secret)
    .update(`${purpose}:${email.toLowerCase()}:${code}`)
    .digest("hex");
}

function codesEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function generateAuthCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export async function invalidateActiveCodes(
  userId: string,
  purpose: AuthCodePurpose,
) {
  await query(
    `UPDATE auth_codes
     SET consumed_at = NOW()
     WHERE user_id = $1
       AND purpose = $2
       AND consumed_at IS NULL`,
    [userId, purpose],
  );
}

export async function issueAuthCode(input: {
  userId: string;
  email: string;
  purpose: AuthCodePurpose;
}) {
  const code = generateAuthCode();
  const codeHash = hashAuthCode(input.purpose, input.email, code);
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  await invalidateActiveCodes(input.userId, input.purpose);

  await query(
    `INSERT INTO auth_codes (user_id, purpose, code_hash, max_attempts, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.userId, input.purpose, codeHash, MAX_ATTEMPTS, expiresAt],
  );

  return { code, expiresAt };
}

export async function getLatestActiveCode(
  userId: string,
  purpose: AuthCodePurpose,
) {
  const result = await query<AuthCodeRow>(
    `SELECT *
     FROM auth_codes
     WHERE user_id = $1
       AND purpose = $2
       AND consumed_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, purpose],
  );
  return result.rows[0] ?? null;
}

export async function secondsUntilResendAllowed(
  userId: string,
  purpose: AuthCodePurpose,
) {
  const latest = await getLatestActiveCode(userId, purpose);
  if (!latest) return 0;
  const createdAt = new Date(latest.created_at).getTime();
  const waitMs = RESEND_COOLDOWN_MS - (Date.now() - createdAt);
  return waitMs > 0 ? Math.ceil(waitMs / 1000) : 0;
}

export type VerifyCodeResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "expired" | "locked" };

export async function verifyAndConsumeAuthCode(input: {
  userId: string;
  email: string;
  purpose: AuthCodePurpose;
  code: string;
}): Promise<VerifyCodeResult> {
  const latest = await getLatestActiveCode(input.userId, input.purpose);
  if (!latest) return { ok: false, reason: "invalid" };

  if (new Date(latest.expires_at).getTime() <= Date.now()) {
    await query(`UPDATE auth_codes SET consumed_at = NOW() WHERE id = $1`, [
      latest.id,
    ]);
    return { ok: false, reason: "expired" };
  }

  if (latest.attempts >= latest.max_attempts) {
    return { ok: false, reason: "locked" };
  }

  const expected = hashAuthCode(input.purpose, input.email, input.code.trim());
  if (!codesEqual(expected, latest.code_hash)) {
    const updated = await query<{ attempts: number; max_attempts: number }>(
      `UPDATE auth_codes
       SET attempts = attempts + 1
       WHERE id = $1
       RETURNING attempts, max_attempts`,
      [latest.id],
    );
    const row = updated.rows[0];
    if (row && row.attempts >= row.max_attempts) {
      await query(`UPDATE auth_codes SET consumed_at = NOW() WHERE id = $1`, [
        latest.id,
      ]);
      return { ok: false, reason: "locked" };
    }
    return { ok: false, reason: "invalid" };
  }

  const consumed = await query(
    `UPDATE auth_codes
     SET consumed_at = NOW()
     WHERE id = $1
       AND consumed_at IS NULL
     RETURNING id`,
    [latest.id],
  );

  if (!consumed.rows[0]) {
    return { ok: false, reason: "invalid" };
  }

  await invalidateActiveCodes(input.userId, input.purpose);
  return { ok: true };
}
