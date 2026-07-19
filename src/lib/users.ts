import { query } from "@/lib/db";

export type UserRow = {
  id: string;
  name: string | null;
  email: string;
  email_verified: Date | null;
  image: string | null;
  password_hash: string | null;
  auth_version: number;
  created_at: Date;
  updated_at: Date;
};

export async function findUserByEmail(email: string) {
  const result = await query<UserRow>(
    `SELECT * FROM users WHERE lower(email) = lower($1) LIMIT 1`,
    [email],
  );
  return result.rows[0] ?? null;
}

export async function findUserById(id: string) {
  const result = await query<UserRow>(
    `SELECT * FROM users WHERE id = $1 LIMIT 1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function createUser(input: {
  name?: string | null;
  email: string;
  passwordHash?: string | null;
  image?: string | null;
  emailVerified?: Date | null;
}) {
  const result = await query<UserRow>(
    `INSERT INTO users (name, email, password_hash, image, email_verified)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      input.name ?? null,
      input.email.toLowerCase(),
      input.passwordHash ?? null,
      input.image ?? null,
      input.emailVerified ?? null,
    ],
  );
  return result.rows[0];
}

export async function upsertGoogleUser(input: {
  name?: string | null;
  email: string;
  image?: string | null;
}) {
  // Google proves email ownership. Clear any password that may have been set by
  // an earlier credentials registration for the same address so the Google owner
  // is the sole way to access the account after linking.
  const result = await query<UserRow>(
    `INSERT INTO users (name, email, image, email_verified)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (email) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, users.name),
       image = COALESCE(EXCLUDED.image, users.image),
       email_verified = NOW(),
       password_hash = NULL,
       updated_at = NOW()
     RETURNING *`,
    [input.name ?? null, input.email.toLowerCase(), input.image ?? null],
  );
  return result.rows[0];
}
