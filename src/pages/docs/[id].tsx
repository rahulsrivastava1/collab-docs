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
import { canEdit, canManageSharing, type DocumentRole } from "@/lib/acl";

type DocumentPayload = {
  id: string;
  title: string;
  content: string;
  role: DocumentRole;
  updated_at: string;
};

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
  const { status } = useSession();
  const id = typeof router.query.id === "string" ? router.query.id : "";

  const [document, setDocument] = useState<DocumentPayload | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydrated = useRef(false);

  const editable = canEdit(document?.role);
  const canShare = canManageSharing(document?.role);

  const loadDocument = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    hydrated.current = false;
    try {
      const res = await fetch(`/api/documents/${id}`);
      const data = (await res.json()) as {
        document?: DocumentPayload;
        error?: string;
      };
      if (!res.ok || !data.document) {
        setLoadError(data.error ?? "Document not found");
        setDocument(null);
        return;
      }
      setDocument(data.document);
      setTitle(data.document.title);
      setContent(data.document.content);
      hydrated.current = true;
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (status === "authenticated" && id) {
      void loadDocument();
    }
  }, [status, id, loadDocument]);

  const saveDocument = useCallback(
    async (nextTitle: string, nextContent: string) => {
      if (!id || !editable) return;
      setSaving(true);
      setSaveError(null);
      try {
        const res = await fetch(`/api/documents/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: nextTitle, content: nextContent }),
        });
        const data = (await res.json()) as {
          document?: DocumentPayload;
          error?: string;
        };
        if (!res.ok) {
          setSaveError(data.error ?? "Could not save");
          return;
        }
        if (data.document) {
          setDocument(data.document);
        }
      } finally {
        setSaving(false);
      }
    },
    [id, editable],
  );

  useEffect(() => {
    if (!hydrated.current || !editable || !document) return;

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void saveDocument(title, content);
    }, 700);

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [title, content, editable, document, saveDocument]);

  async function onDeleteConfirm() {
    if (!id || !canShare) return;

    setDeleting(true);
    setSaveError(null);

    try {
      const res = await fetch(`/api/documents/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        let message = "Could not delete";
        try {
          const data = (await res.json()) as { error?: string };
          message = data.error ?? message;
        } catch {
          // ignore
        }
        setSaveError(message);
        setDeleteOpen(false);
        return;
      }
      await router.push("/docs");
    } catch {
      setSaveError("Network error. Please try again.");
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
                {saving ? " · Saving…" : saveError ? ` · ${saveError}` : " · Saved"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {canShare ? (
                <>
                  <button
                    type="button"
                    onClick={() => setShareOpen(true)}
                    className="btn btn-primary"
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
