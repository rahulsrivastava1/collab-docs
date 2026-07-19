import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";

export const MAX_TITLE_LENGTH = 200;
export const MAX_CONTENT_LENGTH = 500_000;
export const MAX_YJS_UPDATE_BYTES = 512_000;

export const uuidSchema = z.uuid();
export const documentRoleSchema = z.enum(["editor", "viewer"]);

const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export const yjsUpdateSchema = z
  .string()
  .min(1)
  .refine((value) => base64Pattern.test(value), "Invalid Yjs update encoding")
  .refine(
    (value) => Math.floor((value.length * 3) / 4) <= MAX_YJS_UPDATE_BYTES,
    `Yjs update must be at most ${MAX_YJS_UPDATE_BYTES} bytes`,
  );

export const createDocumentSchema = z
  .object({
    title: z.string().trim().min(1).max(MAX_TITLE_LENGTH).optional(),
  })
  .strict();

export const updateDocumentSchema = z
  .object({
    title: z.string().trim().min(1).max(MAX_TITLE_LENGTH).optional(),
    content: z.string().max(MAX_CONTENT_LENGTH).optional(),
    yjsUpdate: yjsUpdateSchema.optional(),
    yjsGeneration: z.number().int().positive().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.title !== undefined ||
      value.content !== undefined ||
      value.yjsUpdate !== undefined,
    "At least one document change is required",
  )
  .refine(
    (value) => value.yjsUpdate === undefined || value.content === undefined,
    "Send either content or yjsUpdate, not both",
  )
  .refine(
    (value) =>
      (value.yjsUpdate === undefined && value.content === undefined) ||
      value.yjsGeneration !== undefined,
    "yjsGeneration is required when updating content",
  );

export const presenceSchema = z
  .object({
    mode: z.enum(["editing", "viewing"]),
    caret: z.number().int().min(0).max(MAX_CONTENT_LENGTH).nullable().optional(),
  })
  .strict();

export const inviteMemberSchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    role: documentRoleSchema,
  })
  .strict();

export const updateMemberSchema = z
  .object({
    role: documentRoleSchema,
  })
  .strict();

export const registerSchema = z
  .object({
    name: z.string().trim().max(100).optional(),
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    password: z.string().min(8).max(128),
  })
  .strict();

export const documentAiSchema = z
  .object({
    action: z.enum(["summarize", "rewrite", "title"]),
  })
  .strict();

export function parseBody<T>(
  schema: z.ZodType<T>,
  req: NextApiRequest,
  res: NextApiResponse,
): T | null {
  const parsed = schema.safeParse(req.body);
  if (parsed.success) return parsed.data;

  res.status(400).json({
    error: "Invalid request",
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  });
  return null;
}

export function parseUuidParam(
  value: string | string[] | undefined,
  label: string,
  res: NextApiResponse,
) {
  const parsed = uuidSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  res.status(400).json({ error: `${label} must be a valid UUID` });
  return null;
}

export function requireSameOrigin(req: NextApiRequest, res: NextApiResponse) {
  const fetchSite = req.headers["sec-fetch-site"];
  if (fetchSite === "cross-site") {
    res.status(403).json({ error: "Cross-site request blocked" });
    return false;
  }

  const origin = req.headers.origin;
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  if (!origin || !host) return true;

  try {
    if (new URL(origin).host !== host) {
      res.status(403).json({ error: "Cross-site request blocked" });
      return false;
    }
  } catch {
    res.status(403).json({ error: "Invalid request origin" });
    return false;
  }

  return true;
}

type RateBucket = { count: number; resetAt: number };
const buckets = new Map<string, RateBucket>();

export function enforceRateLimit(
  res: NextApiResponse,
  input: {
    scope: string;
    identity: string;
    limit: number;
    windowMs: number;
  },
) {
  const now = Date.now();
  const key = `${input.scope}:${input.identity}`;
  let bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + input.windowMs };
    buckets.set(key, bucket);
  }

  bucket.count += 1;
  const remaining = Math.max(0, input.limit - bucket.count);
  res.setHeader("RateLimit-Limit", String(input.limit));
  res.setHeader("RateLimit-Remaining", String(remaining));
  res.setHeader("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

  if (bucket.count > input.limit) {
    res.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
    res.status(429).json({ error: "Too many requests. Please try again shortly." });
    return false;
  }

  // Opportunistic cleanup keeps the process-local limiter bounded.
  if (buckets.size > 10_000) {
    for (const [bucketKey, candidate] of buckets) {
      if (candidate.resetAt <= now) buckets.delete(bucketKey);
    }
  }

  return true;
}

export function requestIp(req: NextApiRequest) {
  return req.socket.remoteAddress ?? "unknown";
}
