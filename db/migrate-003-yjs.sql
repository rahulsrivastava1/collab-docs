-- Yjs CRDT state for Google Docs–style merge of concurrent edits
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS yjs_state BYTEA;
