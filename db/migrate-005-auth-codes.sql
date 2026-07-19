-- Auth codes for email verification and password reset OTPs.
-- Grandfather existing password accounts as verified so only new signups must verify.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS auth_version INTEGER NOT NULL DEFAULT 1;

UPDATE users
SET email_verified = COALESCE(email_verified, NOW()),
    updated_at = NOW()
WHERE password_hash IS NOT NULL
  AND email_verified IS NULL;

CREATE TABLE IF NOT EXISTS auth_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS auth_codes_user_purpose_active_idx
  ON auth_codes (user_id, purpose, created_at DESC)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS auth_codes_expires_at_idx
  ON auth_codes (expires_at);
