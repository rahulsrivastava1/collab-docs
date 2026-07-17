import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import type { GetServerSideProps } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { SiteNav } from "@/components/SiteNav";
import type { DocumentRole } from "@/lib/acl";

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

export default function DocsPage() {
  const router = useRouter();
  const { status } = useSession();
  const [documents, setDocuments] = useState<DocCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDocs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/documents");
      const data = (await res.json()) as { documents?: DocCard[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not load documents");
        return;
      }
      setDocuments(data.documents ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") {
      void loadDocs();
    }
  }, [status, loadDocs]);

  async function createDocument() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Untitled document" }),
      });
      const data = (await res.json()) as {
        document?: { id: string };
        error?: string;
      };
      if (!res.ok || !data.document) {
        setError(data.error ?? "Could not create document");
        return;
      }
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
        <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Documents</h1>
              <p className="mt-1 text-sm text-zinc-600">
                Create, open, and share collaborative documents.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void createDocument()}
              disabled={creating}
              className="btn btn-primary"
            >
              {creating ? "Creating…" : "Blank document"}
            </button>
          </div>

          {error ? (
            <p className="mt-6 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              {error}
            </p>
          ) : null}

          {loading ? (
            <p className="mt-10 text-sm text-zinc-500">Loading documents…</p>
          ) : documents.length === 0 ? (
            <div className="mt-10 rounded-2xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center">
              <p className="text-lg font-medium text-zinc-900">No documents yet</p>
              <p className="mt-2 text-sm text-zinc-600">
                Create a blank document to get started.
              </p>
            </div>
          ) : (
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {documents.map((doc) => (
                <Link
                  key={doc.id}
                  href={`/docs/${doc.id}`}
                  className="group flex flex-col rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-[#1a73e8]/40 hover:shadow-md"
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
