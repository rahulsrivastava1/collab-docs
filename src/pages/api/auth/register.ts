import type { NextApiRequest, NextApiResponse } from "next";
import bcrypt from "bcryptjs";
import { createUser, findUserByEmail } from "@/lib/users";

type Body = {
  name?: string;
  email?: string;
  password?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { name, email, password } = (req.body ?? {}) as Body;

  if (!email?.trim() || !password || password.length < 8) {
    return res.status(400).json({
      error: "Email and a password of at least 8 characters are required.",
    });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = await findUserByEmail(normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: "An account with this email already exists." });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await createUser({
    name: name?.trim() || null,
    email: normalizedEmail,
    passwordHash,
  });

  return res.status(201).json({
    id: user.id,
    email: user.email,
    name: user.name,
  });
}
