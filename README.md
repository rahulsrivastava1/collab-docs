This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/pages/api-reference/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `pages/index.tsx`. The page auto-updates as you edit the file.

[API routes](https://nextjs.org/docs/pages/building-your-application/routing/api-routes) can be accessed on [http://localhost:3000/api/hello](http://localhost:3000/api/hello). This endpoint can be edited in `pages/api/hello.ts`.

The `pages/api` directory is mapped to `/api/*`. Files in this directory are treated as [API routes](https://nextjs.org/docs/pages/building-your-application/routing/api-routes) instead of React pages.

This project uses [`next/font`](https://nextjs.org/docs/pages/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn-pages-router) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/pages/building-your-application/deploying) for more details.

## Security model

- Google sign-in clears any prior password hash for that email so an unverified
  credentials registration cannot keep access after the real owner links Google.
- Content and Yjs writes require a matching `yjsGeneration`, so stale clients
  cannot overwrite a restored document through the plain-content path.
- Every document read is scoped through `document_members`; mutations also repeat
  the role check inside SQL to reduce authorization time-of-check/time-of-use races.
- API bodies and UUID route parameters use strict runtime Zod validation. Unknown
  fields, invalid roles, malformed base64, and oversized values are rejected.
- Next.js body-parser limits cap requests before application parsing. Document
  updates allow 768 KB; smaller endpoints use 1–8 KB limits.
- Writes, presence heartbeats, SSE reconnects, restores, sharing, and registration
  are rate limited with `Retry-After` and `RateLimit-*` response headers.
- Cookie-authenticated mutations reject cross-site requests using `Origin` and
  `Sec-Fetch-Site`. NextAuth provides CSRF protection for auth endpoints.
- Responses include CSP, clickjacking, MIME sniffing, referrer, and permissions
  security headers.
- History reads are capped at the 20 newest snapshots to prevent unbounded reads.

### Deployment note

The included limiter is process-local, suitable for local development and one
long-running Node process. Multi-instance production must replace it with a shared
Redis or database-backed limiter. PostgreSQL row-level security is not enabled, so
new database access must preserve the existing membership-scoped query pattern.
