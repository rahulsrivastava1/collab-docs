import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GetServerSideProps } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { SiteNav } from "@/components/SiteNav";
import { ShareModal } from "@/components/ShareModal";
import { ConfirmModal } from "@/components/ConfirmModal";
import {
  HistoryPanel,
  type RestoredDocument,
} from "@/components/HistoryPanel";
import { PresenceBar, EditorTypingIndicator } from "@/components/PresenceBar";
import { useSync } from "@/components/SyncProvider";
import {
  useDocumentRealtime,
  type RemoteDocumentUpdate,
} from "@/hooks/useDocumentRealtime";
import { canEdit, canManageSharing, type DocumentRole } from "@/lib/acl";
import type { PresenceMode } from "@/lib/realtime-bus";
import {
  deleteLocalDocument,
  discardOutboxForDocument,
  enqueueOutbox,
  getLocalDocument,
  putLocalDocument,
  saveDocumentLocally,
} from "@/lib/local-docs";
import {
  applyRemoteYjsState,
  commitLocalText,
  disposeClientYDoc,
  encodeClientYDocState,
  loadYDocFromServerState,
  yTextString,
} from "@/lib/yjs-client";

type DocumentPayload = {
  id: string;
  title: string;
  content: string;
  role: DocumentRole;
  updated_at: string;
  yjs_state?: string | null;
  yjs_generation?: number;
};

const POLL_MS = 7000;
const POLL_FALLBACK_MS = 30_000;
const EDITING_IDLE_MS = 3_000;

export const getServerSideProps: GetServerSideProps = async (context) => {
  const session = await getServerSession(context.req, context.res, authOptions);
  if (!session?.user) {
    return {
      redirect: { destination: "/login", permanent: false },
    };
  }
  return { props: {} };
};

export default function DocumentEditorPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const { online, syncNow, refreshPendingCount } = useSync();
  const userId = session?.user?.id ?? "";
  const id = typeof router.query.id === "string" ? router.query.id : "";

  const [document, setDocument] = useState<DocumentPayload | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saveLabel, setSaveLabel] = useState<string>("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [bodyFocused, setBodyFocused] = useState(false);
  const [presenceMode, setPresenceMode] = useState<PresenceMode>("viewing");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydrated = useRef(false);
  const lastPersisted = useRef({ title: "", content: "" });
  const lastTypedAt = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const contentRef = useRef("");
  const bodyFocusedRef = useRef(false);
  const caretRef = useRef<number | null>(null);
  const presenceModeRef = useRef<PresenceMode>("viewing");
  const titleRef = useRef("");
  const persistLocalAndMaybeSyncRef = useRef<
    (title: string, content: string) => Promise<void>
  >(async () => {});

  const editable = canEdit(document?.role);
  const canShare = canManageSharing(document?.role);

  presenceModeRef.current = presenceMode;
  titleRef.current = title;

  const markTyping = useCallback(() => {
    lastTypedAt.current = Date.now();
    if (editable && presenceModeRef.current !== "editing") {
      setPresenceMode("editing");
    }
  }, [editable]);

  const syncCaretFromTextarea = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    caretRef.current = ta.selectionStart;
  }, []);

  const scheduleSave = useCallback(() => {
    if (!hydrated.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const body = textareaRef.current?.value ?? contentRef.current;
      contentRef.current = body;
      void persistLocalAndMaybeSyncRef.current(titleRef.current, body);
    }, 450);
  }, []);

  const readBodyContent = useCallback(() => {
    return textareaRef.current?.value ?? contentRef.current;
  }, []);

  /** Apply text into the textarea without stealing caret while user is typing */
  const writeBodyContent = useCallback((next: string, opts?: { force?: boolean }) => {
    contentRef.current = next;
    setContent(next);
    const ta = textareaRef.current;
    if (!ta) return;
    if (opts?.force || !bodyFocusedRef.current) {
      if (ta.value !== next) ta.value = next;
    }
  }, []);

  useEffect(() => {
    if (!editable) {
      setPresenceMode("viewing");
      caretRef.current = null;
      return;
    }

    const tick = () => {
      const recentlyTyped = Date.now() - lastTypedAt.current < EDITING_IDLE_MS;
      const next = bodyFocused || recentlyTyped ? "editing" : "viewing";
      setPresenceMode((prev) => (prev === next ? prev : next));
    };

    tick();
    const timer = setInterval(tick, 1_000);
    return () => clearInterval(timer);
  }, [editable, bodyFocused]);

  const applyFromLocal = useCallback(
    async (opts?: { forceContent?: boolean }) => {
      if (!id || !userId) return null;
      const local = await getLocalDocument(userId, id);
      if (!local) return null;

      setDocument({
        id: local.id,
        title: local.title,
        content: local.content,
        role: local.role,
        updated_at: local.updatedAt,
      });

      if (opts?.forceContent || !local.dirty) {
        setTitle((prev) => (prev === local.title ? prev : local.title));

        // Never rewrite textarea value while the user is focused/typing — that jumps the caret
        if (!bodyFocusedRef.current) {
          writeBodyContent(local.content, { force: Boolean(opts?.forceContent) });
        } else {
          contentRef.current = readBodyContent();
        }

        lastPersisted.current = { title: local.title, content: local.content };
      }

      setSaveLabel(local.dirty ? "Saved locally" : "Synced");
      return local;
    },
    [id, userId, writeBodyContent, readBodyContent],
  );

  const syncDocument = useCallback(
    async (opts?: { quiet?: boolean }) => {
      if (!id || !userId) return;

      const result = await syncNow({ documentId: id });
      if (!result) return;

      const newId = result.remapped[id];
      if (newId && newId !== id) {
        await router.replace(`/docs/${newId}`);
        return;
      }

      const local = await applyFromLocal();
      if (!local && !opts?.quiet) {
        setLoadError("Document not found after sync.");
      }
      if (result.status === "error" && result.error) {
        setSaveError(result.error);
      } else if (result.status === "synced") {
        setSaveError(null);
      }
    },
    [id, userId, syncNow, applyFromLocal, router],
  );

  const loadDocument = useCallback(async () => {
    if (!id || !userId) return;
    setLoading(true);
    setLoadError(null);
    hydrated.current = false;

    try {
      const local = await applyFromLocal({ forceContent: true });
      if (local) {
        hydrated.current = true;
        setLoading(false);
      }

      if (!navigator.onLine) {
        if (!local) {
          setLoadError("Document unavailable offline. Connect to load it once.");
        } else {
          loadYDocFromServerState(id, local.yjsState, local.content);
        }
        return;
      }

      await syncDocument({ quiet: Boolean(local) });

      // Bootstrap Yjs from server state after sync
      try {
        const res = await fetch(`/api/documents/${id}`);
        const data = (await res.json()) as {
          document?: {
            content: string;
            yjs_state?: string | null;
            yjs_generation?: number;
          };
        };
        if (data.document) {
          loadYDocFromServerState(
            id,
            data.document.yjs_state,
            data.document.content ?? local?.content ?? "",
          );
          // Fold any still-local dirty text into the CRDT
          const body = readBodyContent();
          if (body && body !== yTextString(id)) {
            commitLocalText(id, body);
          }
        }
      } catch {
        if (local) loadYDocFromServerState(id, local.yjsState, local.content);
      }

      hydrated.current = true;
    } finally {
      setLoading(false);
    }
  }, [id, userId, applyFromLocal, syncDocument, readBodyContent]);

  useEffect(() => {
    return () => {
      if (id) disposeClientYDoc(id);
    };
  }, [id]);

  useEffect(() => {
    if (status === "authenticated" && id && userId) {
      void loadDocument();
    }
    // Intentionally depend on route/session identity only — avoid reload loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, id, userId]);

  const onRemoteDocumentUpdated = useCallback(
    async (remote: RemoteDocumentUpdate) => {
      if (!id || !userId || remote.id !== id) return;

      const existing = await getLocalDocument(userId, id);
      const remoteGeneration = remote.yjs_generation ?? 1;
      const localGeneration = existing?.yjsGeneration ?? 1;

      if (remoteGeneration !== localGeneration) {
        // A restore creates a new generation: replace instead of merging stale state.
        loadYDocFromServerState(id, remote.yjs_state, remote.content);
        await discardOutboxForDocument(userId, id);
        await putLocalDocument({
          id,
          userId,
          title: remote.title,
          content: remote.content,
          yjsState: remote.yjs_state ?? null,
          yjsGeneration: remoteGeneration,
          role: document?.role ?? existing?.role ?? "viewer",
          ownerName: existing?.ownerName ?? session?.user?.name ?? null,
          ownerEmail: existing?.ownerEmail ?? session?.user?.email ?? "",
          updatedAt: remote.updated_at,
          dirty: false,
        });
        writeBodyContent(remote.content, { force: true });
        setTitle(remote.title);
        lastPersisted.current = { title: remote.title, content: remote.content };
        setSaveLabel("Restored version");
        await refreshPendingCount();
        return;
      }

      // CRDT merge: fold local typing into Y, then apply remote state
      if (bodyFocusedRef.current || Date.now() - lastTypedAt.current < EDITING_IDLE_MS) {
        commitLocalText(id, readBodyContent());
      }

      if (remote.yjs_state) {
        applyRemoteYjsState(id, remote.yjs_state);
      }

      const merged = remote.yjs_state ? yTextString(id) : remote.content;

      await putLocalDocument({
        id,
        userId,
        title: remote.title,
        content: merged,
        yjsState: remote.yjs_state ?? existing?.yjsState ?? null,
        yjsGeneration: remoteGeneration,
        role: document?.role ?? "viewer",
        ownerName: session?.user?.name ?? null,
        ownerEmail: session?.user?.email ?? "",
        updatedAt: remote.updated_at,
        dirty: Boolean(bodyFocusedRef.current),
      });

      if (!bodyFocusedRef.current) {
        writeBodyContent(merged, { force: true });
        setTitle((prev) => (prev === remote.title ? prev : remote.title));
        lastPersisted.current = { title: remote.title, content: merged };
        setSaveLabel("Synced");
      }
    },
    [
      id,
      userId,
      document?.role,
      session?.user?.name,
      session?.user?.email,
      readBodyContent,
      writeBodyContent,
      refreshPendingCount,
    ],
  );

  const onRemoteDocumentDeleted = useCallback(
    async (documentId: string) => {
      if (!id || !userId || documentId !== id) return;
      await deleteLocalDocument(userId, id);
      await router.push("/docs");
    },
    [id, userId, router],
  );

  const { peers, editingPeers, connected: realtimeConnected } = useDocumentRealtime({
    documentId: id,
    userId,
    online,
    mode: presenceMode,
    caretRef,
    enabled: Boolean(id && userId && status === "authenticated" && !loading && !loadError),
    onDocumentUpdated: (doc) => {
      void onRemoteDocumentUpdated(doc);
    },
    onDocumentDeleted: (documentId) => {
      void onRemoteDocumentDeleted(documentId);
    },
  });

  // Poll: fast when SSE down; slow safety net when connected
  useEffect(() => {
    if (!id || !userId || !online || status !== "authenticated") return;

    const interval = realtimeConnected ? POLL_FALLBACK_MS : POLL_MS;
    const timer = setInterval(() => {
      void syncDocument({ quiet: true });
    }, interval);

    return () => clearInterval(timer);
  }, [id, userId, online, status, syncDocument, realtimeConnected]);

  const persistLocalAndMaybeSync = useCallback(
    async (nextTitle: string, nextContent: string) => {
      if (!id || !userId || !editable || !document) return;

      if (
        nextTitle === lastPersisted.current.title &&
        nextContent === lastPersisted.current.content
      ) {
        return;
      }

      setSaveError(null);

      const { yjsUpdateBase64 } = commitLocalText(id, nextContent);
      const existing = await getLocalDocument(userId, id);

      await saveDocumentLocally({
        userId,
        documentId: id,
        title: nextTitle,
        content: nextContent,
        role: document.role,
        ownerName: session?.user?.name ?? null,
        ownerEmail: session?.user?.email ?? "",
        yjsUpdate: yjsUpdateBase64,
        yjsState: encodeClientYDocState(id),
        yjsGeneration: existing?.yjsGeneration ?? 1,
      });
      lastPersisted.current = {
        title: nextTitle.trim() || "Untitled document",
        content: nextContent,
      };
      setSaveLabel("Saved locally");
      await refreshPendingCount();

      if (!navigator.onLine) return;

      await syncNow({ documentId: id });
      await refreshPendingCount();

      // After sync, show merged CRDT text if server returned newer merge
      const local = await getLocalDocument(userId, id);
      if (local && !bodyFocusedRef.current) {
        writeBodyContent(local.content);
      } else if (local && local.content !== readBodyContent()) {
        // Keep caret; optional soft update skipped while focused
      }
      setSaveLabel("Synced");
    },
    [
      id,
      userId,
      editable,
      document,
      session?.user?.name,
      session?.user?.email,
      refreshPendingCount,
      syncNow,
      writeBodyContent,
      readBodyContent,
    ],
  );

  persistLocalAndMaybeSyncRef.current = persistLocalAndMaybeSync;

  // Title-only autosave (body saves via scheduleSave on input)
  useEffect(() => {
    if (!hydrated.current || !editable || !document) return;
    scheduleSave();
  }, [title, editable, document, scheduleSave]);

  async function onVersionRestored(restored: RestoredDocument) {
    if (!id || !userId || !document) return;

    await discardOutboxForDocument(userId, id);
    loadYDocFromServerState(id, restored.yjs_state, restored.content);
    await putLocalDocument({
      id,
      userId,
      title: restored.title,
      content: restored.content,
      yjsState: restored.yjs_state,
      yjsGeneration: restored.yjs_generation,
      role: document.role,
      ownerName: session?.user?.name ?? null,
      ownerEmail: session?.user?.email ?? "",
      updatedAt: restored.updated_at,
      dirty: false,
    });

    setDocument({
      id,
      title: restored.title,
      content: restored.content,
      role: document.role,
      updated_at: restored.updated_at,
      yjs_state: restored.yjs_state,
      yjs_generation: restored.yjs_generation,
    });
    setTitle(restored.title);
    writeBodyContent(restored.content, { force: true });
    lastPersisted.current = {
      title: restored.title,
      content: restored.content,
    };
    setSaveLabel("Restored version");
    await refreshPendingCount();
  }

  async function onDeleteConfirm() {
    if (!id || !canShare || !userId) return;

    setDeleting(true);
    setSaveError(null);

    try {
      await deleteLocalDocument(userId, id);
      await enqueueOutbox({ userId, documentId: id, op: "delete" });
      await refreshPendingCount();

      if (navigator.onLine) {
        const result = await syncNow({ documentId: id });
        if (result?.status === "error") {
          setSaveError(result.error ?? "Could not delete on server");
          setDeleteOpen(false);
          return;
        }
      }

      await router.push("/docs");
    } catch {
      setSaveError("Could not delete. Please try again.");
      setDeleteOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Head>
        <title>{title || "Document"} · Google Docs Clone</title>
      </Head>
      <div className="flex min-h-screen flex-col bg-zinc-100 text-zinc-900">
        <SiteNav />

        <div className="border-b border-zinc-200 bg-white">
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-6 py-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <Link href="/docs" className="text-xs font-medium text-[#1a73e8] hover:underline">
                ← All documents
              </Link>
              <input
                value={title}
                onChange={(e) => {
                  markTyping();
                  setTitle(e.target.value);
                }}
                disabled={!editable}
                className="mt-1 block w-full truncate border-0 bg-transparent p-0 text-xl font-semibold text-zinc-900 outline-none disabled:text-zinc-700"
                placeholder="Untitled document"
              />
              <p className="mt-0.5 text-xs text-zinc-500">
                {document ? `Your role: ${document.role}` : null}
                {saveLabel ? ` · ${saveLabel}` : null}
                {!online ? " · Offline edits stay on this device" : null}
                {saveError ? ` · ${saveError}` : null}
              </p>
            </div>
            <div className="flex flex-col items-stretch gap-2 sm:items-end">
              <PresenceBar peers={peers} connected={realtimeConnected} />
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setHistoryOpen(true)}
                  className="btn btn-secondary"
                  disabled={!online}
                  title={!online ? "Version history requires network" : undefined}
                >
                  History
                </button>
                {canShare ? (
                  <>
                  <button
                    type="button"
                    onClick={() => setShareOpen(true)}
                    className="btn btn-primary"
                    disabled={!online}
                    title={!online ? "Share requires network" : undefined}
                  >
                    Share
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteOpen(true)}
                    className="btn btn-danger"
                  >
                    Delete
                  </button>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-6">
          {loading ? (
            <p className="text-sm text-zinc-500">Loading document…</p>
          ) : loadError ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              {loadError}
            </p>
          ) : (
            <div className="relative">
              <EditorTypingIndicator
                editingPeers={editingPeers}
                textareaRef={textareaRef}
              />
              <textarea
                key={id}
                ref={textareaRef}
                defaultValue={content}
                onChange={(e) => {
                  contentRef.current = e.target.value;
                  caretRef.current = e.target.selectionStart;
                  markTyping();
                  scheduleSave();
                }}
                onSelect={syncCaretFromTextarea}
                onKeyUp={syncCaretFromTextarea}
                onClick={syncCaretFromTextarea}
                onFocus={() => {
                  bodyFocusedRef.current = true;
                  setBodyFocused(true);
                  syncCaretFromTextarea();
                }}
                onBlur={() => {
                  bodyFocusedRef.current = false;
                  setBodyFocused(false);
                  contentRef.current = textareaRef.current?.value ?? contentRef.current;
                }}
                readOnly={!editable}
                placeholder={
                  editable ? "Start typing…" : "You have view-only access to this document."
                }
                className="min-h-[70vh] w-full resize-y rounded-2xl border border-zinc-200 bg-white p-6 text-[15px] leading-7 text-zinc-900 shadow-sm outline-none focus:border-[#1a73e8] focus:ring-2 focus:ring-[#1a73e8]/20 disabled:bg-zinc-50"
              />
            </div>
          )}
        </main>
      </div>

      {id ? (
        <HistoryPanel
          documentId={id}
          open={historyOpen}
          canRestore={editable}
          onClose={() => setHistoryOpen(false)}
          onRestored={onVersionRestored}
        />
      ) : null}

      {id && canShare ? (
        <>
          <ShareModal
            documentId={id}
            open={shareOpen}
            onClose={() => setShareOpen(false)}
          />
          <ConfirmModal
            open={deleteOpen}
            title="Delete document?"
            description={`“${title || "Untitled document"}” will be permanently deleted. This cannot be undone.`}
            confirmLabel="Delete"
            cancelLabel="Cancel"
            danger
            loading={deleting}
            onConfirm={() => void onDeleteConfirm()}
            onClose={() => {
              if (!deleting) setDeleteOpen(false);
            }}
          />
        </>
      ) : null}
    </>
  );
}
