ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS yjs_generation INTEGER NOT NULL DEFAULT 1;

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

-- Give existing documents an initial history entry.
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
