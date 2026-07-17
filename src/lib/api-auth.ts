import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export type SessionUser = {
  id: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
};

export async function requireUser(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<SessionUser | null> {
  const session = await getServerSession(req, res, authOptions);
  const id = session?.user?.id;

  if (!id) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  return {
    id,
    email: session.user?.email,
    name: session.user?.name,
    image: session.user?.image,
  };
}
