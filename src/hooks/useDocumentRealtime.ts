import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import type { PresenceMode, PresencePeer, RealtimeEvent } from "@/lib/realtime-bus";

export type RemoteDocumentUpdate = {
  id: string;
  title: string;
  content: string;
  updated_at: string;
  yjs_state?: string | null;
};

type UseDocumentRealtimeOptions = {
  documentId: string;
  userId: string;
  online: boolean;
  mode: PresenceMode;
  caretRef: MutableRefObject<number | null>;
  enabled?: boolean;
  onDocumentUpdated?: (doc: RemoteDocumentUpdate) => void;
  onDocumentDeleted?: (documentId: string) => void;
};

const PRESENCE_HEARTBEAT_MS = 2_500;
const PRESENCE_POLL_MS = 1_500;
const CARET_PUSH_MS = 350;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 15_000;

function peersEqual(a: PresencePeer[], b: PresencePeer[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.userId !== y.userId ||
      x.mode !== y.mode ||
      x.caret !== y.caret ||
      x.name !== y.name ||
      x.image !== y.image
    ) {
      return false;
    }
  }
  return true;
}

export function useDocumentRealtime({
  documentId,
  userId,
  online,
  mode,
  caretRef,
  enabled = true,
  onDocumentUpdated,
  onDocumentDeleted,
}: UseDocumentRealtimeOptions) {
  const [peers, setPeers] = useState<PresencePeer[]>([]);
  const [connected, setConnected] = useState(false);
  const modeRef = useRef(mode);
  const onUpdatedRef = useRef(onDocumentUpdated);
  const onDeletedRef = useRef(onDocumentDeleted);
  const backoffRef = useRef(RECONNECT_BASE_MS);

  modeRef.current = mode;
  onUpdatedRef.current = onDocumentUpdated;
  onDeletedRef.current = onDocumentDeleted;

  const applyPeers = useCallback(
    (next: PresencePeer[]) => {
      const filtered = next.filter((p) => p.userId !== userId);
      setPeers((prev) => (peersEqual(prev, filtered) ? prev : filtered));
    },
    [userId],
  );

  const postPresence = useCallback(
    async (nextMode: PresenceMode, nextCaret: number | null) => {
      if (!documentId || !online) return;
      try {
        await fetch(`/api/documents/${documentId}/presence`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: nextMode,
            caret: nextMode === "editing" ? nextCaret : null,
          }),
        });
      } catch {
        // ignore
      }
    },
    [documentId, online],
  );

  const pollPresence = useCallback(async () => {
    if (!documentId || !online) return;
    try {
      const res = await fetch(`/api/documents/${documentId}/presence`);
      if (!res.ok) return;
      const data = (await res.json()) as { peers?: PresencePeer[] };
      if (data.peers) applyPeers(data.peers);
    } catch {
      // ignore
    }
  }, [documentId, online, applyPeers]);

  useEffect(() => {
    if (!enabled || !documentId || !userId || !online) {
      setPeers([]);
      return;
    }

    void postPresence(modeRef.current, caretRef.current);
    void pollPresence();

    const heartbeat = setInterval(() => {
      void postPresence(modeRef.current, caretRef.current);
    }, PRESENCE_HEARTBEAT_MS);

    const poll = setInterval(() => {
      void pollPresence();
    }, PRESENCE_POLL_MS);

    return () => {
      clearInterval(heartbeat);
      clearInterval(poll);
    };
  }, [enabled, documentId, userId, online, postPresence, pollPresence, caretRef]);

  useEffect(() => {
    if (!enabled || !documentId || !online) return;

    if (mode === "viewing") {
      void postPresence("viewing", null);
      return;
    }

    void postPresence("editing", caretRef.current);

    const timer = setInterval(() => {
      void postPresence("editing", caretRef.current);
    }, CARET_PUSH_MS);

    return () => clearInterval(timer);
  }, [mode, enabled, documentId, online, postPresence, caretRef]);

  useEffect(() => {
    if (!enabled || !documentId || !userId || !online) {
      setConnected(false);
      return;
    }

    let closed = false;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (closed) return;

      es = new EventSource(`/api/documents/${documentId}/events`);

      es.onopen = () => {
        setConnected(true);
        backoffRef.current = RECONNECT_BASE_MS;
      };

      es.onmessage = (msg) => {
        try {
          const event = JSON.parse(msg.data) as RealtimeEvent;
          if (event.type === "presence_sync" || event.type === "presence") {
            applyPeers(event.peers);
          } else if (event.type === "document_updated") {
            onUpdatedRef.current?.(event.document);
          } else if (event.type === "document_deleted") {
            onDeletedRef.current?.(event.documentId);
          }
        } catch {
          // ignore
        }
      };

      es.onerror = () => {
        if (es && es.readyState !== EventSource.CLOSED) return;
        setConnected(false);
        es?.close();
        es = null;
        if (closed || !navigator.onLine) return;
        const wait = backoffRef.current;
        backoffRef.current = Math.min(wait * 2, RECONNECT_MAX_MS);
        reconnectTimer = setTimeout(connect, wait);
      };
    }

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
      setConnected(false);
    };
  }, [enabled, documentId, userId, online, applyPeers]);

  const editingPeers = peers.filter((p) => p.mode === "editing");

  return {
    peers,
    editingPeers,
    connected,
  };
}
