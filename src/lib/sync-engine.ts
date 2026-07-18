import {
  deleteLocalDocument,
  getLocalDocument,
  listLocalDocuments,
  listPendingOutbox,
  markDocumentClean,
  markOutboxSynced,
  putLocalDocument,
  upsertRemoteDocument,
  upsertRemoteList,
  type RemoteDocument,
  type RemoteDocListItem,
} from "@/lib/local-docs";
import { getLocalDb, type OutboxItem } from "@/lib/local-db";

export type SyncStatus = "idle" | "syncing" | "synced" | "error" | "offline";

export type SyncResult = {
  status: SyncStatus;
  pendingCount: number;
  error?: string;
  flushed: number;
  /** Offline-created local ids → server ids after flush */
  remapped: Record<string, string>;
};

async function markGroupSynced(items: OutboxItem[]) {
  const ids = items
    .map((item) => item.id)
    .filter((id): id is number => typeof id === "number");
  await markOutboxSynced(ids);
}

async function remapDocumentId(userId: string, fromId: string, toId: string) {
  const db = getLocalDb();
  const existing = await getLocalDocument(userId, fromId);
  if (existing) {
    await db.documents.delete(fromId);
    await putLocalDocument({
      ...existing,
      id: toId,
      dirty: false,
    });
  }

  const pending = await listPendingOutbox(userId);
  for (const item of pending) {
    if (item.documentId === fromId && item.id != null) {
      await db.outbox.update(item.id, { documentId: toId });
    }
  }
}

export async function countPendingOutbox(userId: string) {
  const pending = await listPendingOutbox(userId);
  return pending.length;
}

export async function flushOutbox(
  userId: string,
): Promise<{ flushed: number; error?: string; remapped: Record<string, string> }> {
  const remapped: Record<string, string> = {};
  const pending = await listPendingOutbox(userId);
  if (pending.length === 0) return { flushed: 0, remapped };

  const byDoc = new Map<string, OutboxItem[]>();
  for (const item of pending) {
    const list = byDoc.get(item.documentId) ?? [];
    list.push(item);
    byDoc.set(item.documentId, list);
  }

  let flushed = 0;

  for (const [documentId, group] of byDoc) {
    const ops = group.map((g) => g.op);
    const created = ops.includes("create");
    const deleted = ops.includes("delete");

    // Offline create then delete — never hit the server
    if (created && deleted) {
      await deleteLocalDocument(userId, documentId);
      await markGroupSynced(group);
      flushed += group.length;
      continue;
    }

    try {
      if (created) {
        const createItem = group.find((g) => g.op === "create")!;
        const latestUpdate = group.filter((g) => g.op === "update").at(-1);
        const title =
          latestUpdate?.payload.title ?? createItem.payload.title ?? "Untitled document";
        const content =
          latestUpdate?.payload.content ?? createItem.payload.content ?? "";
        const yjsUpdate = latestUpdate?.payload.yjsUpdate;

        const res = await fetch("/api/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        });
        const data = (await res.json()) as {
          document?: RemoteDocument;
          error?: string;
        };
        if (!res.ok || !data.document) {
          return { flushed, error: data.error ?? "Failed to create on server", remapped };
        }

        const serverId = data.document.id;

        if (content || yjsUpdate) {
          const patchRes = await fetch(`/api/documents/${serverId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              yjsUpdate
                ? {
                    title,
                    yjsUpdate,
                    yjsGeneration: latestUpdate?.payload.yjsGeneration ?? 1,
                  }
                : { title, content },
            ),
          });
          if (!patchRes.ok) {
            return { flushed, error: "Created doc but failed to push content", remapped };
          }
          const patched = (await patchRes.json()) as { document?: RemoteDocument };
          if (patched.document) {
            await remapDocumentId(userId, documentId, patched.document.id);
            remapped[documentId] = patched.document.id;
            await markDocumentClean(
              userId,
              patched.document.id,
              patched.document.updated_at,
            );
          }
        } else {
          await remapDocumentId(userId, documentId, serverId);
          remapped[documentId] = serverId;
          await markDocumentClean(userId, serverId, data.document.updated_at);
        }

        await markGroupSynced(group);
        flushed += group.length;
        continue;
      }

      if (deleted) {
        const res = await fetch(`/api/documents/${documentId}`, { method: "DELETE" });
        if (!res.ok && res.status !== 204 && res.status !== 404) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          return { flushed, error: data.error ?? "Failed to delete on server", remapped };
        }
        await deleteLocalDocument(userId, documentId);
        await markGroupSynced(group);
        flushed += group.length;
        continue;
      }

      const latestUpdate = group.filter((g) => g.op === "update").at(-1);
      if (!latestUpdate) {
        await markGroupSynced(group);
        continue;
      }

      // Prefer CRDT updates; merge all pending yjs updates when present
      const yjsParts = group
        .filter((g) => g.op === "update" && g.payload.yjsUpdate)
        .map((g) => g.payload.yjsUpdate!) ;

      let yjsUpdate: string | undefined;
      if (yjsParts.length === 1) {
        yjsUpdate = yjsParts[0];
      } else if (yjsParts.length > 1) {
        const Y = await import("yjs");
        const merged = Y.mergeUpdates(
          yjsParts.map((b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))),
        );
        let binary = "";
        merged.forEach((b) => {
          binary += String.fromCharCode(b);
        });
        yjsUpdate = btoa(binary);
      } else if (latestUpdate.payload.yjsUpdate) {
        yjsUpdate = latestUpdate.payload.yjsUpdate;
      }

      const res = await fetch(`/api/documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          yjsUpdate
            ? {
                title: latestUpdate.payload.title,
                yjsUpdate,
              yjsGeneration: latestUpdate.payload.yjsGeneration ?? 1,
              }
            : {
                title: latestUpdate.payload.title,
                content: latestUpdate.payload.content,
              },
        ),
      });
      const data = (await res.json()) as { document?: RemoteDocument; error?: string };

      if (res.status === 409 && data.document) {
        // A restore created a new generation. The restore is authoritative;
        // discard stale queued edits and adopt the restored CRDT state.
        const existing = await getLocalDocument(userId, documentId);
        const { loadYDocFromServerState } = await import("@/lib/yjs-client");
        loadYDocFromServerState(
          documentId,
          data.document.yjs_state,
          data.document.content,
        );
        await putLocalDocument({
          id: documentId,
          userId,
          title: data.document.title,
          content: data.document.content,
          yjsState: data.document.yjs_state ?? null,
          yjsGeneration: data.document.yjs_generation ?? 1,
          role: existing?.role ?? data.document.role,
          ownerName: existing?.ownerName ?? null,
          ownerEmail: existing?.ownerEmail ?? "",
          updatedAt: data.document.updated_at,
          dirty: false,
        });
        await markGroupSynced(group);
        flushed += group.length;
        continue;
      }

      if (!res.ok) {
        const db = getLocalDb();
        for (const item of group) {
          if (item.id != null) await db.outbox.update(item.id, { status: "failed" });
        }
        return { flushed, error: data.error ?? "Failed to sync update", remapped };
      }

      if (data.document) {
        const existing = await getLocalDocument(userId, documentId);
        if (
          data.document.yjs_state &&
          (data.document.yjs_generation ?? 1) !== (existing?.yjsGeneration ?? 1)
        ) {
          const { loadYDocFromServerState } = await import("@/lib/yjs-client");
          loadYDocFromServerState(
            documentId,
            data.document.yjs_state,
            data.document.content,
          );
        }
        await putLocalDocument({
          id: documentId,
          userId,
          title: data.document.title,
          content: data.document.content,
          yjsState: data.document.yjs_state ?? null,
          yjsGeneration: data.document.yjs_generation ?? existing?.yjsGeneration ?? 1,
          role: existing?.role ?? "editor",
          ownerName: existing?.ownerName ?? null,
          ownerEmail: existing?.ownerEmail ?? "",
          updatedAt: data.document.updated_at,
          dirty: false,
        });
      }
      await markGroupSynced(group);
      flushed += group.length;
    } catch (error) {
      return {
        flushed,
        remapped,
        error: error instanceof Error ? error.message : "Sync network error",
      };
    }
  }

  return { flushed, remapped };
}

export async function pullDocumentList(userId: string) {
  const res = await fetch("/api/documents");
  const data = (await res.json()) as {
    documents?: RemoteDocListItem[];
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error ?? "Failed to pull documents");
  }
  await upsertRemoteList(userId, data.documents ?? []);
  return listLocalDocuments(userId);
}

export async function pullDocument(
  userId: string,
  documentId: string,
  extras?: { ownerName?: string | null; ownerEmail?: string },
) {
  const res = await fetch(`/api/documents/${documentId}`);
  const data = (await res.json()) as {
    document?: RemoteDocument;
    error?: string;
  };
  if (!res.ok || !data.document) {
    throw new Error(data.error ?? "Failed to pull document");
  }
  return upsertRemoteDocument(userId, data.document, extras);
}

/**
 * Local-first sync:
 * 1) Flush local outbox → server
 * 2) Pull remote → local (dirty local content is preserved)
 */
export async function runSync(
  userId: string,
  options?: {
    documentId?: string;
    ownerName?: string | null;
    ownerEmail?: string;
  },
): Promise<SyncResult> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    const pendingCount = await countPendingOutbox(userId);
    return { status: "offline", pendingCount, flushed: 0, remapped: {} };
  }

  try {
    const flush = await flushOutbox(userId);
    await pullDocumentList(userId);

    const pullId =
      (options?.documentId && flush.remapped[options.documentId]) ||
      options?.documentId;

    if (pullId) {
      await pullDocument(userId, pullId, {
        ownerName: options.ownerName,
        ownerEmail: options.ownerEmail,
      }).catch(() => {
        // Document may have been deleted or remapped; ignore single-doc pull failure
      });
    }

    const pendingCount = await countPendingOutbox(userId);

    if (flush.error) {
      return {
        status: "error",
        pendingCount,
        flushed: flush.flushed,
        remapped: flush.remapped,
        error: flush.error,
      };
    }

    return {
      status: pendingCount > 0 ? "syncing" : "synced",
      pendingCount,
      flushed: flush.flushed,
      remapped: flush.remapped,
    };
  } catch (error) {
    const pendingCount = await countPendingOutbox(userId);
    return {
      status: "error",
      pendingCount,
      flushed: 0,
      remapped: {},
      error: error instanceof Error ? error.message : "Sync failed",
    };
  }
}
