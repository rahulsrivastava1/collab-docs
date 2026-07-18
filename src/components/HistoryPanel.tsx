import { useEffect, useRef, useState } from "react";
import { useDialogFocus } from "@/lib/use-dialog-focus";

export type DocumentVersion = {
  id: string;
  title: string;
  content: string;
  created_at: string;
  author_name: string | null;
  author_email: string | null;
  restored_from_version_id: string | null;
};

export type RestoredDocument = {
  id: string;
  title: string;
  content: string;
  role: "owner" | "editor" | "viewer";
  updated_at: string;
  yjs_state: string | null;
  yjs_generation: number;
};

type HistoryPanelProps = {
  documentId: string;
  open: boolean;
  canRestore: boolean;
  onClose: () => void;
  onRestored: (document: RestoredDocument) => Promise<void> | void;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function author(version: DocumentVersion) {
  return version.author_name || version.author_email || "Unknown user";
}

export function HistoryPanel({
  documentId,
  open,
  canRestore,
  onClose,
  onRestored,
}: HistoryPanelProps) {
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useDialogFocus(panelRef, {
    open,
    onClose,
    initialFocusRef: closeRef,
  });

  useEffect(() => {
    if (!open || !documentId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    void fetch(`/api/documents/${documentId}/versions`)
      .then(async (res) => {
        const data = (await res.json()) as {
          versions?: DocumentVersion[];
          error?: string;
        };
        if (!res.ok) throw new Error(data.error ?? "Could not load history");
        if (cancelled) return;
        const next = data.versions ?? [];
        setVersions(next);
        setSelectedId((current) =>
          current && next.some((version) => version.id === current)
            ? current
            : next[0]?.id ?? null,
        );
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "Could not load history");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, documentId]);

  if (!open) return null;

  const selected = versions.find((version) => version.id === selectedId) ?? null;

  async function restoreSelected() {
    if (!selected || !canRestore) return;
    setRestoring(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/documents/${documentId}/versions/${selected.id}/restore`,
        { method: "POST" },
      );
      const data = (await res.json()) as {
        document?: RestoredDocument;
        error?: string;
      };
      if (!res.ok || !data.document) {
        throw new Error(data.error ?? "Could not restore version");
      }
      await onRestored(data.document);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not restore version");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-black/20"
        aria-label="Close version history"
        onClick={onClose}
      />

      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-title"
        aria-describedby="history-description"
        className="relative flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl"
      >
        <header className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <h2 id="history-title" className="text-lg font-semibold text-zinc-900">
              Version history
            </h2>
            <p id="history-description" className="text-xs text-zinc-500">
              Automatic snapshots, at most once per minute
            </p>
          </div>
          <button ref={closeRef} type="button" className="btn btn-ghost shrink-0" onClick={onClose}>
            Close
          </button>
        </header>

        {error ? (
          <p
            role="alert"
            className="mx-4 mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 sm:mx-5"
          >
            {error}
          </p>
        ) : null}

        <div className="grid min-h-0 flex-1 grid-rows-[minmax(10rem,35%)_1fr] sm:grid-cols-[220px_1fr] sm:grid-rows-none">
          <div className="overflow-y-auto border-b border-zinc-200 bg-zinc-50 p-3 sm:border-b-0 sm:border-r">
            {loading ? (
              <p className="p-2 text-sm text-zinc-500" role="status">
                Loading history…
              </p>
            ) : versions.length === 0 ? (
              <p className="p-2 text-sm text-zinc-500">No versions yet.</p>
            ) : (
              <div className="space-y-1.5" role="listbox" aria-label="Versions">
                {versions.map((version) => {
                  const isSelected = selectedId === version.id;
                  return (
                    <button
                      key={version.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => setSelectedId(version.id)}
                      className={`w-full rounded-lg px-3 py-2 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1a73e8] ${
                        isSelected
                          ? "bg-[#e8f0fe] text-[#1557b0]"
                          : "text-zinc-700 hover:bg-zinc-100"
                      }`}
                    >
                      <span className="block text-xs font-semibold">
                        {formatDate(version.created_at)}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] opacity-75">
                        {author(version)}
                      </span>
                      {version.restored_from_version_id ? (
                        <span className="mt-1 inline-block rounded-full bg-white px-2 py-0.5 text-[10px] font-medium">
                          Restored
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-col">
            {selected ? (
              <>
                <div className="border-b border-zinc-200 px-4 py-3 sm:px-5">
                  <p className="truncate text-sm font-semibold text-zinc-900">
                    {selected.title}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {formatDate(selected.created_at)} · {author(selected)}
                  </p>
                </div>
                <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-4 font-sans text-sm leading-7 text-zinc-800 sm:p-5">
                  {selected.content || "This version is empty."}
                </pre>
                <footer className="border-t border-zinc-200 px-4 py-4 sm:px-5">
                  {canRestore ? (
                    <button
                      type="button"
                      className="btn btn-primary w-full"
                      disabled={restoring}
                      onClick={() => void restoreSelected()}
                    >
                      {restoring ? "Restoring…" : "Restore this version"}
                    </button>
                  ) : (
                    <p className="text-center text-xs text-zinc-500">
                      Viewers can inspect history but cannot restore versions.
                    </p>
                  )}
                </footer>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
                Select a version to preview it.
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
