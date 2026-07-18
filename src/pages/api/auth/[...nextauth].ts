import NextAuth from "next-auth";
import type { NextApiRequest, NextApiResponse } from "next";
import { authOptions } from "@/lib/auth";
import {
  enforceRateLimit,
  requestIp,
} from "@/lib/api-security";

const nextAuthHandler = NextAuth(authOptions);

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const authPath = Array.isArray(req.query.nextauth)
    ? req.query.nextauth.join("/")
    : "";
  const isCredentialsAttempt =
    req.method === "POST" && authPath === "callback/credentials";

  if (
    isCredentialsAttempt &&
    !enforceRateLimit(res, {
      scope: "credentials-login",
      identity: requestIp(req),
      limit: 10,
      windowMs: 15 * 60_000,
    })
  ) return;

  return nextAuthHandler(req, res);
}
