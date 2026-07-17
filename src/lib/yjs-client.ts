import * as Y from "yjs";

const TEXT_KEY = "content";

const docs = new Map<string, Y.Doc>();

function toBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function fromBase64(b64: string) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function applyPlainTextDiff(ytext: Y.Text, next: string) {
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

export function getClientYDoc(documentId: string) {
  let doc = docs.get(documentId);
  if (!doc) {
    doc = new Y.Doc();
    docs.set(documentId, doc);
  }
  return doc;
}

export function disposeClientYDoc(documentId: string) {
  const doc = docs.get(documentId);
  if (doc) {
    doc.destroy();
    docs.delete(documentId);
  }
}

export function loadYDocFromServerState(
  documentId: string,
  stateBase64: string | null | undefined,
  fallbackText: string,
) {
  disposeClientYDoc(documentId);
  const doc = new Y.Doc();
  if (stateBase64) {
    Y.applyUpdate(doc, fromBase64(stateBase64));
  } else if (fallbackText) {
    doc.getText(TEXT_KEY).insert(0, fallbackText);
  }
  docs.set(documentId, doc);
  return doc;
}

export function applyRemoteYjsState(
  documentId: string,
  stateBase64: string | null | undefined,
) {
  if (!stateBase64) return getClientYDoc(documentId);
  const doc = getClientYDoc(documentId);
  Y.applyUpdate(doc, fromBase64(stateBase64));
  return doc;
}

export function yTextString(documentId: string) {
  return getClientYDoc(documentId).getText(TEXT_KEY).toString();
}

/**
 * Apply textarea value into Y.Text via diff, return base64 update to sync.
 */
export function commitLocalText(documentId: string, nextText: string) {
  const doc = getClientYDoc(documentId);
  const ytext = doc.getText(TEXT_KEY);
  const updates: Uint8Array[] = [];

  const onUpdate = (update: Uint8Array) => {
    updates.push(update);
  };
  doc.on("update", onUpdate);
  try {
    doc.transact(() => {
      applyPlainTextDiff(ytext, nextText);
    });
  } finally {
    doc.off("update", onUpdate);
  }

  if (updates.length === 0) {
    return { text: ytext.toString(), yjsUpdateBase64: null as string | null };
  }

  const merged = updates.length === 1 ? updates[0] : Y.mergeUpdates(updates);
  return {
    text: ytext.toString(),
    yjsUpdateBase64: toBase64(merged),
  };
}
