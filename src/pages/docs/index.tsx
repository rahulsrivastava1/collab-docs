import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import type { GetServerSideProps } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { SiteNav } from "@/components/SiteNav";
import { useSync } from "@/components/SyncProvider";
import type { DocumentRole } from "@/lib/acl";
import {
  enqueueOutbox,
  listLocalDocuments,
  putLocalDocument,
  toDocCard,
} from "@/lib/local-docs";

type DocCard = {
  id: string;
  title: string;
  updated_at: string;
  role: DocumentRole;
  owner_name: string | null;
  owner_email: string;
};

function formatUpdated(value: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function roleLabel(role: DocumentRole) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export const getServerSideProps: GetServerSideProps = async (context) => {
  const session = await getServerSession(context.req, context.res, authOptions);
  if (!session?.user) {
    return {
      redirect: { destination: "/login", permanent: false },
    };
  }
  return { props: {} };
};

function DocsSkeleton() {
  return (
    <div
      className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      aria-hidden
    >
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={index}
          className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"
        >
          <div className="skeleton h-28 w-full" />
          <div className="skeleton mt-4 h-4 w-3/4" />
          <div className="skeleton mt-2 h-3 w-1/2" />
          <div className="mt-3 flex justify-between gap-2">
            <div className="skeleton h-6 w-16 rounded-full" />
            <div className="skeleton h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function DocsPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const { online, syncNow, refreshPendingCount } = useSync();
  const userId = session?.user?.id ?? "";

  const [documents, setDocuments] = useState<DocCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshFromLocal = useCallback(async () => {
    if (!userId) return;
    const local = await listLocalDocuments(userId);
    setDocuments(local.map(toDocCard));
  }, [userId]);

  const loadDocs = useCallback(async () => {
    if (!userId) return;
    setError(null);

    // 1) Local-first
    await refreshFromLocal();
    setLoading(false);

    // 2) F3: sync on opening /docs (flush outbox, then pull)
    if (navigator.onLine) {
      await syncNow();
      await refreshFromLocal();
      await refreshPendingCount();
    }
  }, [userId, refreshFromLocal, syncNow, refreshPendingCount]);

  useEffect(() => {
    if (status === "authenticated" && userId) {
      void loadDocs();
    }
  }, [status, userId, loadDocs]);

  async function createDocument() {
    if (!userId) return;
    setCreating(true);
    setError(null);

    try {
      if (!online) {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        await putLocalDocument({
          id,
          userId,
          title: "Untitled document",
          content: "",
          role: "owner",
          ownerName: session?.user?.name ?? null,
          ownerEmail: session?.user?.email ?? "",
          updatedAt: now,
          dirty: true,
        });
        await enqueueOutbox({
          userId,
          documentId: id,
          op: "create",
          payload: { title: "Untitled document", content: "" },
        });
        await refreshPendingCount();
        await router.push(`/docs/${id}`);
        return;
      }

      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled document" }),
      });
      const data = (await res.json()) as {
        document?: {
          id: string;
          title: string;
          content: string;
          role: DocumentRole;
          updated_at: string;
        };
        error?: string;
      };
      if (!res.ok || !data.document) {
        setError(data.error ?? "Could not create document");
        return;
      }

      await putLocalDocument({
        id: data.document.id,
        userId,
        title: data.document.title,
        content: data.document.content ?? "",
        role: data.document.role,
        ownerName: session?.user?.name ?? null,
        ownerEmail: session?.user?.email ?? "",
        updatedAt: data.document.updated_at,
        dirty: false,
      });

      await router.push(`/docs/${data.document.id}`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <Head>
        <title>Documents · Google Docs Clone</title>
      </Head>
      <div className="flex min-h-screen flex-col bg-zinc-100 text-zinc-900">
        <SiteNav />
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Documents
              </h1>
              <p className="mt-1 text-sm text-zinc-600">
                Local-first with background sync — edits go to this device first, then
                the server.
              </p>
              {!online ? (
                <p
                  className="mt-2 inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900"
                  role="status"
                >
                  Offline — new docs stay on this device until you reconnect
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => void createDocument()}
              disabled={creating}
              className="btn btn-primary w-full sm:w-auto"
            >
              {creating ? "Creating…" : "Blank document"}
            </button>
          </div>

          {error ? (
            <p
              role="alert"
              className="mt-6 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700"
            >
              {error}
            </p>
          ) : null}

          {loading ? (
            <>
              <p className="sr-only" role="status">
                Loading documents…
              </p>
              <DocsSkeleton />
            </>
          ) : documents.length === 0 ? (
            <div className="mt-10 rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center">
              <p className="text-lg font-medium text-zinc-900">No documents yet</p>
              <p className="mt-2 text-sm text-zinc-600">
                Create a blank document to get started
                {!online ? " — it will sync when you are back online" : ""}.
              </p>
              <button
                type="button"
                onClick={() => void createDocument()}
                disabled={creating}
                className="btn btn-primary mt-6"
              >
                {creating ? "Creating…" : "Create blank document"}
              </button>
            </div>
          ) : (
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {documents.map((doc) => (
                <Link
                  key={doc.id}
                  href={`/docs/${doc.id}`}
                  className="card-link group flex flex-col rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-[#1a73e8]/40 hover:shadow-md"
                >
                  <div className="flex h-28 items-center justify-center rounded-xl bg-zinc-50 text-[#1a73e8]">
                    <svg
                      className="size-10"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden
                    >
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm1 7V3.5L19.5 9H15Z" />
                    </svg>
                  </div>
                  <h2 className="mt-4 truncate text-base font-semibold text-zinc-900 group-hover:text-[#1557b0]">
                    {doc.title || "Untitled document"}
                  </h2>
                  <p className="mt-1 text-xs text-zinc-500">
                    Updated {formatUpdated(doc.updated_at)}
                  </p>
                  <div className="mt-3 flex items-center justify-between gap-2 text-xs">
                    <span className="rounded-full bg-zinc-100 px-2.5 py-1 font-medium text-zinc-700">
                      {roleLabel(doc.role)}
                    </span>
                    <span className="truncate text-zinc-500">
                      {doc.owner_name || doc.owner_email}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </main>
      </div>
    </>
  );
}
