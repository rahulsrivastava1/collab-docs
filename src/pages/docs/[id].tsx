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
import { useSync } from "@/components/SyncProvider";
import { canEdit, canManageSharing, type DocumentRole } from "@/lib/acl";
import {
  deleteLocalDocument,
  enqueueOutbox,
  getLocalDocument,
  saveDocumentLocally,
} from "@/lib/local-docs";

type DocumentPayload = {
  id: string;
  title: string;
  content: string;
  role: DocumentRole;
  updated_at: string;
};

const POLL_MS = 7000;

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
  const [deleting, setDeleting] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydrated = useRef(false);
  const lastPersisted = useRef({ title: "", content: "" });

  const editable = canEdit(document?.role);
  const canShare = canManageSharing(document?.role);

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

      // Don't clobber in-progress typing; dirty means local edits win
      if (opts?.forceContent || !local.dirty) {
        setTitle(local.title);
        setContent(local.content);
        lastPersisted.current = { title: local.title, content: local.content };
      }

      setSaveLabel(local.dirty ? "Saved locally" : "Synced");
      return local;
    },
    [id, userId],
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
      // 1) Local-first
      const local = await applyFromLocal({ forceContent: true });
      if (local) {
        hydrated.current = true;
        setLoading(false);
      }

      // 2) F3: sync when opening a document
      if (!navigator.onLine) {
        if (!local) {
          setLoadError("Document unavailable offline. Connect to load it once.");
        }
        return;
      }

      await syncDocument({ quiet: Boolean(local) });
      hydrated.current = true;
    } finally {
      setLoading(false);
    }
  }, [id, userId, applyFromLocal, syncDocument]);

  useEffect(() => {
    if (status === "authenticated" && id && userId) {
      void loadDocument();
    }
    // Intentionally depend on route/session identity only — avoid reload loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, id, userId]);

  // P2: poll while document is open and online
  useEffect(() => {
    if (!id || !userId || !online || status !== "authenticated") return;

    const timer = setInterval(() => {
      void syncDocument({ quiet: true });
    }, POLL_MS);

    return () => clearInterval(timer);
  }, [id, userId, online, status, syncDocument]);

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

      await saveDocumentLocally({
        userId,
        documentId: id,
        title: nextTitle,
        content: nextContent,
        role: document.role,
        ownerName: session?.user?.name ?? null,
        ownerEmail: session?.user?.email ?? "",
      });
      lastPersisted.current = {
        title: nextTitle.trim() || "Untitled document",
        content: nextContent,
      };
      setSaveLabel("Saved locally");
      await refreshPendingCount();

      if (!navigator.onLine) return;

      await syncDocument({ quiet: true });
    },
    [
      id,
      userId,
      editable,
      document,
      session?.user?.name,
      session?.user?.email,
      refreshPendingCount,
      syncDocument,
    ],
  );

  useEffect(() => {
    if (!hydrated.current || !editable || !document) return;

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void persistLocalAndMaybeSync(title, content);
    }, 450);

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [title, content, editable, document, persistLocalAndMaybeSync]);

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
          <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1">
              <Link href="/docs" className="text-xs font-medium text-[#1a73e8] hover:underline">
                ← All documents
              </Link>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
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
            <div className="flex items-center gap-2">
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

        <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-6">
          {loading ? (
            <p className="text-sm text-zinc-500">Loading document…</p>
          ) : loadError ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              {loadError}
            </p>
          ) : (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              readOnly={!editable}
              placeholder={
                editable ? "Start typing…" : "You have view-only access to this document."
              }
              className="min-h-[70vh] w-full resize-y rounded-2xl border border-zinc-200 bg-white p-6 text-[15px] leading-7 text-zinc-900 shadow-sm outline-none focus:border-[#1a73e8] focus:ring-2 focus:ring-[#1a73e8]/20 disabled:bg-zinc-50"
            />
          )}
        </main>
      </div>

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
