import Dexie, { type EntityTable } from "dexie";
import type { DocumentRole } from "@/lib/acl";

export type LocalDocument = {
  id: string;
  userId: string;
  title: string;
  content: string;
  role: DocumentRole;
  ownerName: string | null;
  ownerEmail: string;
  updatedAt: string;
  dirty: boolean;
};

export type OutboxOp = "create" | "update" | "delete";

export type OutboxItem = {
  id?: number;
  userId: string;
  documentId: string;
  op: OutboxOp;
  payload: {
    title?: string;
    content?: string;
    yjsUpdate?: string;
  };
  createdAt: string;
  status: "pending" | "synced" | "failed";
};

const db = new Dexie("GoogleDocsCloneLocal") as Dexie & {
  documents: EntityTable<LocalDocument, "id">;
  outbox: EntityTable<OutboxItem, "id">;
};

db.version(1).stores({
  documents: "id, userId, updatedAt",
  outbox: "++id, userId, documentId, status, createdAt",
});

export function getLocalDb() {
  if (typeof window === "undefined") {
    throw new Error("Local DB is only available in the browser");
  }
  return db;
}

export { db as localDb };
