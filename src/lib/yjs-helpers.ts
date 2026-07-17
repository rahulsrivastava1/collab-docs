import * as Y from "yjs";

const TEXT_KEY = "content";

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
  const doc = yDocFromState(existingState, fallbackText);
  const update = Buffer.from(updateBase64, "base64");
  Y.applyUpdate(doc, new Uint8Array(update));
  return {
    state: encodeYDocState(doc),
    content: yDocToPlainText(doc),
    stateBase64: Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64"),
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
