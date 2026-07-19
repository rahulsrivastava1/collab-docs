# Google Docs Clone — Project Explanation

> A complete walkthrough of the project: what it is, the technologies used, the architecture,
> how the code is organized, and how each feature works end to end. This document is written to
> explain the project for review (e.g. a hiring assignment).

---

## 1. What This Project Is

This is a **real-time collaborative document editor** — a simplified Google Docs clone. Multiple
people can sign in, create documents, edit the same document at the same time, see each other's
live presence (who is viewing/typing and where), share documents with role-based permissions,
browse and restore version history, and use AI (Google Gemini) to summarize, rewrite, or title
their content.

A key design decision is that the app is **local-first**: the UI reads and writes to a local
in-browser database first, so it stays responsive and keeps working offline. Changes are then
synced to the server in the background. Concurrent edits are merged automatically using a **CRDT
(Yjs)** so two people editing at once never overwrite each other.

---

## 2. Tech Stack (What I Used and Why)

| Layer | Technology | Why it was used |
|-------|-----------|-----------------|
| Framework | **Next.js 16** (Pages Router) | Full-stack React — serves the UI *and* the backend API routes from one codebase |
| UI | **React 19** + **TypeScript** | Component-based UI with type safety |
| Styling | **Tailwind CSS v4** | Utility-first styling; configured CSS-first (no JS config file in v4) |
| Database | **PostgreSQL 16** (via `pg` driver) | Reliable relational store; raw SQL (no ORM) for full control |
| Auth | **NextAuth v4** | Email/password **and** Google OAuth, using JWT sessions |
| Passwords | **bcryptjs** | Secure password hashing (cost factor 12) |
| Realtime merge | **Yjs** | CRDT that merges concurrent edits with zero conflicts |
| Offline storage | **Dexie** (IndexedDB) | Local-first document cache + a sync "outbox" |
| AI | **Vercel AI SDK** + **@ai-sdk/google** (Gemini) | Summarize / rewrite / generate title |
| Validation | **Zod v4** | Validates request bodies, UUIDs, and roles on the server |

**Not used (intentional design choices):**
- No ORM (e.g. Prisma) — the schema is plain SQL in the `db/` folder.
- No WebSocket server for edits — edits are saved via HTTP `PATCH` and changes are *pushed* to
  other clients using **Server-Sent Events (SSE)**.
- The rich editor is a plain `<textarea>` — collaboration works at the character level through
  Yjs text diffs, keeping the editor simple while still being conflict-free.

---

## 3. High-Level Architecture

```
┌───────────────────────────── Browser (Client) ─────────────────────────────┐
│  React Pages / Components                                                    │
│      │                                                                       │
│      ├─ Yjs client doc  ──► turns text edits into CRDT updates               │
│      ├─ Dexie (IndexedDB) ──► local-first cache + outbox (offline queue)     │
│      ├─ sync-engine / SyncProvider ──► flush outbox, pull remote changes     │
│      └─ EventSource (SSE) ──► receives live "document updated / presence"    │
└───────────────┬─────────────────────────────────────────────┬──────────────┘
                │ HTTP (PATCH/GET/POST)                         │ SSE stream
┌───────────────▼─────────────────────────────────────────────▼──────────────┐
│                         Next.js API Routes (Server)                          │
│   NextAuth (JWT) · Zod validation · rate limiting · same-origin checks       │
│      │                 │                    │                 │              │
│      ▼                 ▼                    ▼                 ▼              │
│   yjs-helpers      realtime-bus          ai.ts            documents.ts       │
│  (merge CRDT)    (in-memory pub/sub)   (Gemini)         (DB queries)         │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                     ▼
                          ┌────────────────────┐
                          │   PostgreSQL 16    │
                          │  users, documents, │
                          │  members, versions │
                          └────────────────────┘
```

**Three sources of state:**
1. **PostgreSQL** — the authoritative source of truth (documents, Yjs binary state, members, versions).
2. **Dexie (IndexedDB)** — the local, offline-capable cache the UI reads/writes first.
3. **realtime-bus (server memory)** — ephemeral presence and "something changed" notifications.

---

## 4. Project Structure

```
google-docs-clone/
├── db/                       # Database schema & migrations (raw SQL, no ORM)
│   ├── init.sql              # Full schema — runs automatically on first DB start
│   └── migrate-*.sql         # Incremental migrations for existing databases
├── docker-compose.yml        # Local PostgreSQL 16 container
├── next.config.ts            # Security headers (CSP etc.), strict mode
├── postcss.config.mjs        # Tailwind v4 wiring
├── .env.example              # All required/optional environment variables
└── src/
    ├── pages/                # Routes (Pages Router)
    │   ├── index.tsx         # Landing page
    │   ├── login.tsx         # Sign in (email/password + Google)
    │   ├── register.tsx      # Create account
    │   ├── docs/index.tsx    # Document dashboard (list + create)
    │   ├── docs/[id].tsx     # The document editor (the core screen)
    │   └── api/              # Backend API endpoints (see section 8)
    ├── components/           # UI building blocks (nav, share, history, AI, presence…)
    ├── hooks/                # useDocumentRealtime (SSE + presence), useOnlineStatus
    ├── lib/                  # Server + client logic (db, auth, acl, yjs, sync, ai…)
    ├── styles/globals.css    # Tailwind import + design tokens/utilities
    └── types/                # TypeScript type augmentation for NextAuth
```

---

## 5. The Database Schema

Defined in `db/init.sql` (no ORM — plain SQL applied on first container start).

- **`users`** — `id`, `name`, `email` (unique), `image`, `password_hash`, `auth_version`, timestamps.
  - `auth_version` is a clever trick: bumping this number instantly invalidates a user's existing
    JWT sessions (used for logout-everywhere / security).
- **`documents`** — `title`, `content` (plain-text mirror for quick reads/search), `yjs_state`
  (the binary CRDT state as `BYTEA`), `yjs_generation` (a counter), `owner_id`.
  - `yjs_generation` guards version restores: after a restore it is incremented so stale clients
    can't merge old (deleted) text back in.
- **`document_members`** — links users to documents with a `role` of `owner | editor | viewer`
  (unique per document/user pair).
- **`document_versions`** — periodic snapshots of a document (title, content, yjs state) with
  `created_by` and an optional `restored_from_version_id`.

---

## 6. Authentication — How Sign-In Works

1. **Register** (`POST /api/auth/register`): the email/password is validated with Zod, the
   password is hashed with **bcrypt (cost 12)**, and a `users` row is created.
2. **Login**: NextAuth's **Credentials** provider compares the password against the stored hash;
   alternatively the **Google** provider signs users in via OAuth (creating/linking the account).
3. **Session**: uses the **JWT** strategy. On every token refresh the server checks the user's
   `auth_version` in the DB — if it doesn't match, the session is invalidated.
4. **Protecting pages**: `/docs` and `/docs/[id]` use **server-side rendering (SSR) auth gates** —
   if there's no session, the server redirects to `/login` before the page renders.
5. **Protecting APIs**: every API route calls `requireUser()` which returns **401** if unauthenticated.
6. **Hardening**: register and login endpoints are rate-limited to slow down brute-force attempts.

---

## 7. Core Feature — Real-Time Collaborative Editing

This is the heart of the project. Here's the full data flow when a user types:

```
1. User types in the <textarea>
2. yjs-client diffs old vs new text → produces a small CRDT update
3. The change is saved locally to Dexie immediately (marked "dirty") + queued in the outbox
4. If online, sync-engine sends PATCH /api/documents/:id  { yjsUpdate: <base64> }
5. Server locks the row (SELECT ... FOR UPDATE), merges the CRDT update into yjs_state,
   updates the plain-text mirror, and (at most once per minute) saves a version snapshot
6. Server broadcasts a "document_updated" event on the realtime-bus
7. Other clients (listening via SSE at /events) receive the event, fetch the new yjs_state,
   and merge it into their local Yjs doc — text appears with no conflicts
```

**Why Yjs (CRDT)?** If two people edit simultaneously, a naive "last write wins" approach loses
data. A CRDT mathematically guarantees that all edits merge into the same consistent result
regardless of order — so nobody's typing gets clobbered.

**Presence** (who's here / who's typing):
- The client sends a heartbeat (`POST /presence`) with its mode (viewing/editing) and caret
  position. Presence has a 15-second TTL, so stale users disappear automatically.
- Peers are shown as avatars, and typing users get a name chip near their caret position.

**Transport detail:** edits themselves go over normal HTTP `PATCH`; the *notification* that
"something changed" is pushed over **SSE**. If the SSE connection drops, the client falls back to
polling (every 7s while disconnected, every 30s while connected).

---

## 8. Offline / Local-First Sync

- The UI **always reads from and writes to Dexie (IndexedDB) first**, so it's instant and works
  with no network.
- Every change is queued in a Dexie **outbox** table.
- `SyncProvider` watches the online status. When the connection returns, `sync-engine`:
  1. flushes the outbox (sends queued changes to the server),
  2. pulls the latest remote state,
  3. remaps offline-created documents (which used a temporary client-generated UUID) to their
     real server IDs,
  4. handles restore conflicts (HTTP **409** when `yjs_generation` doesn't match).
- The connection status (Online / Offline / Syncing / Synced / N pending) is shown live in the nav bar.

---

## 9. Sharing, Roles & Permissions (ACL)

Access control is centralized in `src/lib/acl.ts`. Roles and what they can do:

| Capability | Owner | Editor | Viewer |
|------------|:-----:|:------:|:------:|
| Read document | ✅ | ✅ | ✅ |
| Edit content | ✅ | ✅ | ❌ |
| View history | ✅ | ✅ | ✅ |
| Restore a version | ✅ | ✅ | ❌ |
| AI: Summarize | ✅ | ✅ | ✅ |
| AI: Rewrite / Title | ✅ | ✅ | ❌ |
| Share / manage members | ✅ | ❌ | ❌ |
| Delete document | ✅ | ❌ | ❌ |

The owner uses the **Share** modal to invite people by email as Editor or Viewer, change roles,
or remove them. (Invitees must already have an account.)

---

## 10. Version History

- After edits, the server saves a snapshot **at most once per minute** (throttled with an advisory
  lock so it doesn't spam snapshots on every keystroke).
- The **History** panel lists versions; users can preview and (if editor/owner) **restore** one.
- On restore, the document content is replaced, a fresh Yjs state is created, and
  `yjs_generation` is incremented — this prevents stale clients from merging the old deleted text
  back in.

---

## 11. AI Assistance (Google Gemini)

- The **AI** panel (`src/components/AiPanel.tsx`) calls `POST /api/documents/[id]/ai`.
- Actions:
  - **Summarize** — available to any reader.
  - **Rewrite** — improves selected/whole text (editors+).
  - **Generate title** — suggests a title (editors+).
- The backend (`src/lib/ai.ts`) sends a crafted prompt to Gemini via the Vercel AI SDK; content
  is clipped to ~40k characters to stay within limits.
- Rate-limited to one request per action per user per configurable window (default 5 minutes).
- AI is **optional** — without an API key the buttons return a clear "not configured" message.

---

## 12. API Reference (Backend Endpoints)

All routes require authentication, validate inputs with Zod, and apply rate limits + same-origin
checks on mutations.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `*` | `/api/auth/[...nextauth]` | NextAuth login/session handlers |
| `POST` | `/api/auth/register` | Create an email/password account |
| `GET` | `/api/documents` | List the current user's documents |
| `POST` | `/api/documents` | Create a document |
| `GET` | `/api/documents/[id]` | Fetch one document (content + Yjs state) |
| `PATCH` | `/api/documents/[id]` | Update title/content/Yjs; merge + broadcast |
| `DELETE` | `/api/documents/[id]` | Delete a document (owner only) |
| `GET` | `/api/documents/[id]/events` | **SSE** stream (updates + presence) |
| `GET`/`POST` | `/api/documents/[id]/presence` | Read / send presence heartbeat |
| `GET`/`POST` | `/api/documents/[id]/members` | List / invite members |
| `PATCH`/`DELETE` | `/api/documents/[id]/members/[userId]` | Change role / remove member |
| `GET` | `/api/documents/[id]/versions` | List version history |
| `POST` | `/api/documents/[id]/versions/[versionId]/restore` | Restore a version |
| `POST` | `/api/documents/[id]/ai` | Gemini summarize / rewrite / title |

---

## 13. Security Measures

- **Password hashing** with bcrypt (cost 12); passwords never stored in plaintext.
- **JWT session invalidation** via `auth_version` (instant logout-everywhere).
- **Zod validation** on all request bodies, UUIDs, and roles.
- **Same-origin checks** on mutating (POST/PATCH/DELETE) requests to mitigate CSRF.
- **Rate limiting** on auth, AI, and other sensitive routes.
- **Request size caps** to prevent oversized payloads.
- **Security headers** in `next.config.ts`: Content-Security-Policy, `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, Referrer-Policy, Permissions-Policy, and `X-Powered-By` hidden.
- **Server-side authorization** for every action via the centralized ACL (never trusting the client).

---

## 14. How to Run It

```bash
# 1. Install dependencies (Node 20.9+, pnpm)
pnpm install

# 2. Configure environment
cp .env.example .env      # set NEXTAUTH_SECRET (openssl rand -base64 32) and DATABASE_URL

# 3. Start PostgreSQL (tables auto-create on first run)
pnpm db:up

# 4. Run the dev server
pnpm dev                  # open http://localhost:3000
```

**Available scripts:** `dev`, `build`, `start`, `db:up`, `db:down`, `db:logs`, `db:migrate`.

Google sign-in and AI features are optional — add the relevant keys to `.env` to enable them.

---

## 15. Key Files to Look At (For a Reviewer)

| To understand… | Read this file |
|----------------|----------------|
| The editor screen (ties everything together) | `src/pages/docs/[id].tsx` |
| CRDT merge logic (server) | `src/lib/yjs-helpers.ts` |
| CRDT text-diff logic (client) | `src/lib/yjs-client.ts` |
| Offline sync engine | `src/lib/sync-engine.ts` + `src/components/SyncProvider.tsx` |
| Realtime presence/updates | `src/hooks/useDocumentRealtime.ts` + `src/lib/realtime-bus.ts` |
| Authentication config | `src/lib/auth.ts` |
| Permissions model | `src/lib/acl.ts` |
| Database queries | `src/lib/documents.ts` |
| AI integration | `src/lib/ai.ts` |
| Database schema | `db/init.sql` |

---

## 16. Summary

This project demonstrates a full-stack, production-minded application:

- **Full-stack Next.js** with a clean separation of pages, components, hooks, and library logic.
- **Real, conflict-free collaboration** using Yjs CRDTs (not a naive last-write-wins).
- **Local-first, offline-capable** architecture with a sync outbox and reconciliation.
- **Live presence** via Server-Sent Events with polling fallback.
- **Role-based sharing**, **version history with safe restore**, and **AI assistance**.
- **Security-first**: hashing, session invalidation, validation, rate limiting, CSP, and
  server-side authorization on every action.
