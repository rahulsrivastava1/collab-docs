import * as Y from "yjs";
import { MAX_CONTENT_LENGTH, MAX_YJS_UPDATE_BYTES } from "@/lib/api-security";

const TEXT_KEY = "content";
const MAX_YJS_STATE_BYTES = MAX_YJS_UPDATE_BYTES * 2;

export function createYDocFromPlainText(text: string) {
  const doc = new Y.Doc();
  const ytext = doc.getText(TEXT_KEY);
  if (text) {
    ytext.insert(0, text);
  }
  return doc;
}

export function yDocFromState(state: Uint8Array | Buffer | null | undefined, fallbackText = "") {
  const doc = new Y.Doc();
  if (state && state.length > 0) {
    Y.applyUpdate(doc, state instanceof Buffer ? new Uint8Array(state) : state);
  } else if (fallbackText) {
    doc.getText(TEXT_KEY).insert(0, fallbackText);
  }
  return doc;
}

export function encodeYDocState(doc: Y.Doc) {
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

export function yDocToPlainText(doc: Y.Doc) {
  return doc.getText(TEXT_KEY).toString();
}

export function applyYjsUpdateToState(
  existingState: Uint8Array | Buffer | null | undefined,
  updateBase64: string,
  fallbackText = "",
) {
  const update = Buffer.from(updateBase64, "base64");
  if (update.length > MAX_YJS_UPDATE_BYTES) {
    throw new Error(`Yjs update exceeds ${MAX_YJS_UPDATE_BYTES} bytes`);
  }

  const doc = yDocFromState(existingState, fallbackText);
  Y.applyUpdate(doc, new Uint8Array(update));

  const content = yDocToPlainText(doc);
  if (content.length > MAX_CONTENT_LENGTH) {
    throw new Error(`Document content exceeds ${MAX_CONTENT_LENGTH} characters`);
  }

  const state = encodeYDocState(doc);
  if (state.length > MAX_YJS_STATE_BYTES) {
    throw new Error(`Yjs state exceeds ${MAX_YJS_STATE_BYTES} bytes`);
  }

  return {
    state,
    content,
    stateBase64: state.toString("base64"),
  };
}

export function stateToBase64(state: Uint8Array | Buffer | null | undefined) {
  if (!state || state.length === 0) return null;
  const buf = state instanceof Buffer ? state : Buffer.from(state);
  return buf.toString("base64");
}

/**
 * Apply a plain-text edit as a minimal Y.Text diff (so concurrent edits merge).
 */
export function applyPlainTextDiff(ytext: Y.Text, next: string) {
  const current = ytext.toString();
  if (current === next) return;

  let start = 0;
  const minLen = Math.min(current.length, next.length);
  while (start < minLen && current[start] === next[start]) start++;

  let endOld = current.length;
  let endNew = next.length;
  while (
    endOld > start &&
    endNew > start &&
    current[endOld - 1] === next[endNew - 1]
  ) {
    endOld--;
    endNew--;
  }

  const deleteLen = endOld - start;
  if (deleteLen > 0) ytext.delete(start, deleteLen);
  const insertText = next.slice(start, endNew);
  if (insertText) ytext.insert(start, insertText);
}
