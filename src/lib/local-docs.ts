import {
  getLocalDb,
  type LocalDocument,
  type OutboxItem,
  type OutboxOp,
} from "@/lib/local-db";
import type { DocumentRole } from "@/lib/acl";

export type RemoteDocListItem = {
  id: string;
  title: string;
  updated_at: string;
  role: DocumentRole;
  owner_name: string | null;
  owner_email: string;
};

export type RemoteDocument = {
  id: string;
  title: string;
  content: string;
  role: DocumentRole;
  updated_at: string;
  owner_name?: string | null;
  owner_email?: string;
  yjs_state?: string | null;
  yjs_generation?: number;
};

export async function listLocalDocuments(userId: string) {
  const db = getLocalDb();
  return db.documents.where("userId").equals(userId).reverse().sortBy("updatedAt");
}

export async function getLocalDocument(userId: string, documentId: string) {
  const db = getLocalDb();
  const doc = await db.documents.get(documentId);
  if (!doc || doc.userId !== userId) return null;
  return doc;
}

export async function putLocalDocument(doc: LocalDocument) {
  const db = getLocalDb();
  await db.documents.put(doc);
  return doc;
}

export async function deleteLocalDocument(userId: string, documentId: string) {
  const db = getLocalDb();
  const existing = await db.documents.get(documentId);
  if (existing && existing.userId === userId) {
    await db.documents.delete(documentId);
  }
}

export async function upsertRemoteList(userId: string, docs: RemoteDocListItem[]) {
  const db = getLocalDb();
  await db.transaction("rw", db.documents, async () => {
    for (const remote of docs) {
      const existing = await db.documents.get(remote.id);
      if (existing?.dirty) {
        // Keep local unpushed edits; only refresh metadata if missing content
        await db.documents.put({
          ...existing,
          role: remote.role,
          ownerName: remote.owner_name,
          ownerEmail: remote.owner_email,
        });
        continue;
      }

      await db.documents.put({
        id: remote.id,
        userId,
        title: remote.title,
        content: existing?.content ?? "",
        yjsState: existing?.yjsState ?? null,
        yjsGeneration: existing?.yjsGeneration ?? 1,
        role: remote.role,
        ownerName: remote.owner_name,
        ownerEmail: remote.owner_email,
        updatedAt: remote.updated_at,
        dirty: false,
      });
    }
  });
}

export async function upsertRemoteDocument(
  userId: string,
  remote: RemoteDocument,
  extras?: { ownerName?: string | null; ownerEmail?: string },
) {
  const db = getLocalDb();
  const existing = await db.documents.get(remote.id);

  if (existing?.dirty) {
    await db.documents.put({
      ...existing,
      role: remote.role,
      ownerName: extras?.ownerName ?? existing.ownerName,
      ownerEmail: extras?.ownerEmail ?? existing.ownerEmail,
    });
    return getLocalDocument(userId, remote.id);
  }

  const next: LocalDocument = {
    id: remote.id,
    userId,
    title: remote.title,
    content: remote.content,
    yjsState: remote.yjs_state ?? null,
    yjsGeneration: remote.yjs_generation ?? 1,
    role: remote.role,
    ownerName: extras?.ownerName ?? remote.owner_name ?? existing?.ownerName ?? null,
    ownerEmail: extras?.ownerEmail ?? remote.owner_email ?? existing?.ownerEmail ?? "",
    updatedAt: remote.updated_at,
    dirty: false,
  };
  await db.documents.put(next);
  return next;
}

export async function saveDocumentLocally(input: {
  userId: string;
  documentId: string;
  title: string;
  content: string;
  role: DocumentRole;
  ownerName?: string | null;
  ownerEmail?: string;
  yjsUpdate?: string | null;
  yjsState?: string | null;
  yjsGeneration?: number;
}) {
  const now = new Date().toISOString();
  const existing = await getLocalDocument(input.userId, input.documentId);

  const next: LocalDocument = {
    id: input.documentId,
    userId: input.userId,
    title: input.title.trim() || "Untitled document",
    content: input.content,
    yjsState: input.yjsState ?? existing?.yjsState ?? null,
    yjsGeneration: input.yjsGeneration ?? existing?.yjsGeneration ?? 1,
    role: input.role,
    ownerName: input.ownerName ?? existing?.ownerName ?? null,
    ownerEmail: input.ownerEmail ?? existing?.ownerEmail ?? "",
    updatedAt: now,
    dirty: true,
  };

  await putLocalDocument(next);
  await enqueueOutbox({
    userId: input.userId,
    documentId: input.documentId,
    op: existing ? "update" : "create",
    payload: {
      title: next.title,
      content: next.content,
      ...(input.yjsUpdate ? { yjsUpdate: input.yjsUpdate } : {}),
      yjsGeneration: next.yjsGeneration,
    },
  });

  return next;
}

export async function enqueueOutbox(input: {
  userId: string;
  documentId: string;
  op: OutboxOp;
  payload?: OutboxItem["payload"];
}) {
  const db = getLocalDb();
  await db.outbox.add({
    userId: input.userId,
    documentId: input.documentId,
    op: input.op,
    payload: input.payload ?? {},
    createdAt: new Date().toISOString(),
    status: "pending",
  });
}

export async function discardOutboxForDocument(userId: string, documentId: string) {
  const db = getLocalDb();
  const items = await db.outbox.where("userId").equals(userId).toArray();
  const ids = items
    .filter((item) => item.documentId === documentId && item.id != null)
    .map((item) => item.id!);
  await db.outbox.bulkDelete(ids);
}

export async function listPendingOutbox(userId: string) {
  const db = getLocalDb();
  const items = await db.outbox.where("userId").equals(userId).sortBy("createdAt");
  return items.filter((item) => item.status === "pending");
}

export async function markOutboxSynced(ids: number[]) {
  if (ids.length === 0) return;
  const db = getLocalDb();
  await db.transaction("rw", db.outbox, async () => {
    for (const id of ids) {
      await db.outbox.update(id, { status: "synced" });
    }
  });
}

export async function markDocumentClean(userId: string, documentId: string, updatedAt?: string) {
  const db = getLocalDb();
  const existing = await db.documents.get(documentId);
  if (!existing || existing.userId !== userId) return;
  await db.documents.put({
    ...existing,
    dirty: false,
    updatedAt: updatedAt ?? existing.updatedAt,
  });
}

export function toDocCard(doc: LocalDocument) {
  return {
    id: doc.id,
    title: doc.title,
    updated_at: doc.updatedAt,
    role: doc.role,
    owner_name: doc.ownerName,
    owner_email: doc.ownerEmail,
  };
}
