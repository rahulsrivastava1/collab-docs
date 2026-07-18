export type PresenceMode = "viewing" | "editing";

export type PresencePeer = {
  userId: string;
  name: string | null;
  image: string | null;
  mode: PresenceMode;
  /** Character offset in document — used to place "X is typing" near their caret */
  caret: number | null;
  updatedAt: number;
};

export type RealtimeEvent =
  | { type: "presence_sync"; peers: PresencePeer[] }
  | { type: "presence"; peers: PresencePeer[] }
  | {
      type: "document_updated";
      document: {
        id: string;
        title: string;
        content: string;
        updated_at: string;
        yjs_state?: string | null;
        yjs_generation?: number;
      };
    }
  | { type: "document_deleted"; documentId: string };

type Subscriber = (event: RealtimeEvent) => void;

type Room = {
  subscribers: Map<string, Set<Subscriber>>;
  presence: Map<string, PresencePeer>;
};

const PRESENCE_TTL_MS = 15_000;
const CLEANUP_INTERVAL_MS = 5_000;

const globalForRealtime = globalThis as typeof globalThis & {
  __docsRealtimeRooms?: Map<string, Room>;
  __docsRealtimeCleanup?: ReturnType<typeof setInterval>;
};

function rooms(): Map<string, Room> {
  if (!globalForRealtime.__docsRealtimeRooms) {
    globalForRealtime.__docsRealtimeRooms = new Map();
  }
  return globalForRealtime.__docsRealtimeRooms;
}

function getOrCreateRoom(documentId: string): Room {
  const map = rooms();
  let room = map.get(documentId);
  if (!room) {
    room = { subscribers: new Map(), presence: new Map() };
    map.set(documentId, room);
  }
  return room;
}

function presenceSnapshot(room: Room): PresencePeer[] {
  return Array.from(room.presence.values()).sort((a, b) =>
    (a.name ?? a.userId).localeCompare(b.name ?? b.userId),
  );
}

function broadcastRoom(documentId: string, event: RealtimeEvent, exceptUserId?: string) {
  const room = rooms().get(documentId);
  if (!room) return;

  for (const [userId, subs] of room.subscribers) {
    if (exceptUserId && userId === exceptUserId) continue;
    for (const sub of subs) {
      try {
        sub(event);
      } catch {
        // ignore broken subscriber
      }
    }
  }
}

function ensureCleanupTimer() {
  if (globalForRealtime.__docsRealtimeCleanup) return;

  globalForRealtime.__docsRealtimeCleanup = setInterval(() => {
    const now = Date.now();
    for (const [documentId, room] of rooms()) {
      let changed = false;
      for (const [userId, peer] of room.presence) {
        if (now - peer.updatedAt > PRESENCE_TTL_MS) {
          room.presence.delete(userId);
          changed = true;
        }
      }
      if (changed) {
        broadcastRoom(documentId, {
          type: "presence",
          peers: presenceSnapshot(room),
        });
      }
      if (room.subscribers.size === 0 && room.presence.size === 0) {
        rooms().delete(documentId);
      }
    }
  }, CLEANUP_INTERVAL_MS);

  // Don't keep the process alive solely for cleanup in Node
  if (typeof globalForRealtime.__docsRealtimeCleanup.unref === "function") {
    globalForRealtime.__docsRealtimeCleanup.unref();
  }
}

export function subscribe(
  documentId: string,
  userId: string,
  subscriber: Subscriber,
): () => void {
  ensureCleanupTimer();
  const room = getOrCreateRoom(documentId);
  let set = room.subscribers.get(userId);
  if (!set) {
    set = new Set();
    room.subscribers.set(userId, set);
  }
  set.add(subscriber);

  return () => {
    const current = room.subscribers.get(userId);
    if (!current) return;
    current.delete(subscriber);
    if (current.size === 0) {
      room.subscribers.delete(userId);
      // Presence is owned by heartbeats/TTL — do not clear on SSE disconnect
    }
  };
}

export function subscriberCount(documentId: string, userId: string) {
  return rooms().get(documentId)?.subscribers.get(userId)?.size ?? 0;
}

export function setPresence(
  documentId: string,
  peer: Omit<PresencePeer, "updatedAt"> & { updatedAt?: number },
): PresencePeer[] {
  ensureCleanupTimer();
  const room = getOrCreateRoom(documentId);
  const next: PresencePeer = {
    userId: peer.userId,
    name: peer.name,
    image: peer.image,
    mode: peer.mode,
    caret: typeof peer.caret === "number" ? peer.caret : null,
    updatedAt: peer.updatedAt ?? Date.now(),
  };
  room.presence.set(peer.userId, next);
  const peers = presenceSnapshot(room);
  broadcastRoom(documentId, { type: "presence", peers });
  return peers;
}

export function removePresence(documentId: string, userId: string): PresencePeer[] {
  const room = rooms().get(documentId);
  if (!room) return [];

  const existed = room.presence.delete(userId);
  const peers = presenceSnapshot(room);
  if (existed) {
    broadcastRoom(documentId, { type: "presence", peers });
  }
  return peers;
}

export function getPresenceSnapshot(documentId: string): PresencePeer[] {
  const room = rooms().get(documentId);
  if (!room) return [];
  return presenceSnapshot(room);
}

export function broadcast(documentId: string, event: RealtimeEvent, exceptUserId?: string) {
  broadcastRoom(documentId, event, exceptUserId);
}
