-- Runs automatically on first container start (empty volume only).
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE document_role AS ENUM ('owner', 'editor', 'viewer');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  email TEXT NOT NULL UNIQUE,
  email_verified TIMESTAMPTZ,
  image TEXT,
  password_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL DEFAULT 'Untitled document',
  content TEXT NOT NULL DEFAULT '',
  yjs_state BYTEA,
  yjs_generation INTEGER NOT NULL DEFAULT 1,
  owner_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS documents_owner_id_idx ON documents (owner_id);
CREATE INDEX IF NOT EXISTS documents_updated_at_idx ON documents (updated_at DESC);

CREATE TABLE IF NOT EXISTS document_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role document_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_id, user_id)
);

CREATE INDEX IF NOT EXISTS document_members_user_id_idx ON document_members (user_id);
CREATE INDEX IF NOT EXISTS document_members_document_id_idx ON document_members (document_id);

CREATE TABLE IF NOT EXISTS document_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  yjs_state BYTEA,
  yjs_generation INTEGER NOT NULL DEFAULT 1,
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  restored_from_version_id UUID REFERENCES document_versions (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS document_versions_document_created_idx
  ON document_versions (document_id, created_at DESC);

INSERT INTO document_versions (
  document_id,
  title,
  content,
  yjs_state,
  yjs_generation,
  created_by,
  created_at
)
SELECT
  d.id,
  d.title,
  d.content,
  d.yjs_state,
  d.yjs_generation,
  d.owner_id,
  d.updated_at
FROM documents d
WHERE NOT EXISTS (
  SELECT 1
  FROM document_versions dv
  WHERE dv.document_id = d.id
);
