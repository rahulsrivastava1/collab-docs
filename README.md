# Google Docs Clone

A real-time collaborative document editor built with Next.js and PostgreSQL. Create, share, and edit rich documents together, with live presence, version history, and AI writing assistance.

## Features

- **Accounts & sign-in** — Email + password (with 6-digit email verification codes) or Google sign-in.
- **Password reset** — Secure "forgot password" flow with emailed one-time codes.
- **Documents** — Create, rename, edit, and delete documents with autosave.
- **Real-time collaboration** — Multiple people can edit the same document at once; edits merge automatically (CRDT/Yjs) with no conflicts.
- **Live presence** — See who else is viewing or editing, including where they are typing.
- **Sharing & roles** — Invite people as **Owner**, **Editor**, or **Viewer** with per-role permissions.
- **Version history** — Browse previous versions of a document and restore any of them.
- **AI assistance (Gemini)** — Summarize a document, rewrite selected text, or auto-generate a title.

## Requirements

- **Node.js** 20.9 or newer
- **pnpm** (`npm install -g pnpm`)
- **Docker** (for the local PostgreSQL database) — or any PostgreSQL database URL

## Getting started

### 1. Clone and install

```bash
git clone <your-repo-url>
cd google-docs-clone
pnpm install
```

### 2. Configure environment

Copy the example file and fill in the values:

```bash
cp .env.example .env
```

At minimum you need:

| Variable | What it's for | How to get it |
|----------|---------------|---------------|
| `NEXTAUTH_SECRET` | Session/JWT signing | Run `openssl rand -base64 32` |
| `DATABASE_URL` | PostgreSQL connection | Local Docker default works out of the box |
| `SMTP_*` / `EMAIL_FROM` | Sending verification & reset codes | Any SMTP provider (Gmail app password, Mailtrap, Resend, etc.) |
| `GOOGLE_GENERATIVE_AI_API_KEY` | AI features | Free key at [Google AI Studio](https://aistudio.google.com/app/apikey) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google sign-in (optional) | [Google Cloud Console](https://console.cloud.google.com/apis/credentials) |

> Google sign-in and AI features are optional — the app runs without them, and those buttons simply return a clear "not configured" message.

### 3. Start the database

Using the included Docker setup (tables are created automatically on first start):

```bash
pnpm db:up
```

Prefer a hosted database (Neon, Supabase, Aiven, etc.)? Set `DATABASE_URL` to your connection string (include `?sslmode=require`) and create the tables once:

```bash
psql "$DATABASE_URL" -f db/init.sql
```

### 4. Run the app

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## How to use

1. Register with your email, then enter the 6-digit code sent to your inbox (or sign in with Google).
2. Create a new document from the dashboard.
3. Click **Share** to invite others as Editor or Viewer.
4. Open the same document in another browser/account to see live collaboration and presence.
5. Use the **History** panel to view or restore earlier versions, and the **AI** panel to summarize, rewrite, or title your document.

## Available scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start the development server |
| `pnpm build` | Build for production |
| `pnpm start` | Run the production build |
| `pnpm db:up` | Start the local PostgreSQL container |
| `pnpm db:down` | Stop the local PostgreSQL container |

## Tech stack

Next.js · React · TypeScript · PostgreSQL · NextAuth · Yjs · Tailwind CSS · Google Gemini
