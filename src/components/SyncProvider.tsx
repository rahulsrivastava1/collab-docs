import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSession } from "next-auth/react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import {
  countPendingOutbox,
  runSync,
  type SyncResult,
  type SyncStatus,
} from "@/lib/sync-engine";

type SyncContextValue = {
  online: boolean;
  status: SyncStatus;
  pendingCount: number;
  error: string | null;
  syncNow: (options?: { documentId?: string }) => Promise<SyncResult | null>;
  refreshPendingCount: () => Promise<void>;
};

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const { data: session, status: authStatus } = useSession();
  const online = useOnlineStatus();
  const userId = session?.user?.id ?? "";

  const [status, setStatus] = useState<SyncStatus>("idle");
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const syncingRef = useRef(false);

  const refreshPendingCount = useCallback(async () => {
    if (!userId) {
      setPendingCount(0);
      return;
    }
    const count = await countPendingOutbox(userId);
    setPendingCount(count);
  }, [userId]);

  const syncNow = useCallback(
    async (options?: { documentId?: string }): Promise<SyncResult | null> => {
      if (!userId || syncingRef.current) return null;

      if (!navigator.onLine) {
        setStatus("offline");
        await refreshPendingCount();
        const pending = await countPendingOutbox(userId);
        return { status: "offline", pendingCount: pending, flushed: 0, remapped: {} };
      }

      syncingRef.current = true;
      setStatus("syncing");
      setError(null);

      try {
        const result = await runSync(userId, {
          documentId: options?.documentId,
          ownerName: session?.user?.name ?? null,
          ownerEmail: session?.user?.email ?? "",
        });
        setPendingCount(result.pendingCount);
        setStatus(result.status);
        setError(result.error ?? null);
        return result;
      } finally {
        syncingRef.current = false;
      }
    },
    [userId, session?.user?.name, session?.user?.email, refreshPendingCount],
  );

  useEffect(() => {
    if (authStatus === "authenticated" && userId) {
      void refreshPendingCount();
    }
  }, [authStatus, userId, refreshPendingCount]);

  // F3: sync on reconnect
  useEffect(() => {
    function onOnline() {
      if (userId) void syncNow();
    }
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [userId, syncNow]);

  useEffect(() => {
    if (!online) setStatus("offline");
  }, [online]);

  const value = useMemo(
    () => ({
      online,
      status,
      pendingCount,
      error,
      syncNow,
      refreshPendingCount,
    }),
    [online, status, pendingCount, error, syncNow, refreshPendingCount],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync() {
  const ctx = useContext(SyncContext);
  if (!ctx) {
    throw new Error("useSync must be used within SyncProvider");
  }
  return ctx;
}
