import { useEffect, useId, useRef, useState } from "react";
import { useDialogFocus } from "@/lib/use-dialog-focus";

export type AiAction = "summarize" | "rewrite" | "title";

type AiPanelProps = {
  documentId: string;
  canEdit: boolean;
  online: boolean;
  currentContent: string;
  onApplyRewrite: (nextContent: string) => void;
  onApplyTitle: (nextTitle: string) => void;
};

type ModalState =
  | { kind: "summary"; text: string }
  | { kind: "rewrite"; before: string; after: string }
  | null;

function formatRetryMessage(retryAfterSec: number | null) {
  if (retryAfterSec == null || retryAfterSec <= 0) {
    return "AI usage is rate limited — try again shortly.";
  }
  const mins = Math.floor(retryAfterSec / 60);
  const secs = retryAfterSec % 60;
  const wait = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  return `AI usage is rate limited — try again in ${wait}.`;
}

export function AiPanel({
  documentId,
  canEdit,
  online,
  currentContent,
  onApplyRewrite,
  onApplyTitle,
}: AiPanelProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<AiAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const summaryDialogRef = useRef<HTMLDivElement | null>(null);
  const rewriteDialogRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();

  useDialogFocus(summaryDialogRef, {
    open: modal?.kind === "summary",
    onClose: () => setModal(null),
  });

  useDialogFocus(rewriteDialogRef, {
    open: modal?.kind === "rewrite",
    onClose: () => setModal(null),
  });

  useEffect(() => {
    if (!menuOpen) return;

    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
        triggerRef.current?.focus();
        return;
      }

      const items = menuRef.current
        ? Array.from(
            menuRef.current.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
          )
        : [];
      if (items.length === 0) return;

      const currentIndex = items.findIndex((item) => item === document.activeElement);

      if (event.key === "ArrowDown") {
        event.preventDefault();
        const next = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
        items[next]?.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        const next =
          currentIndex < 0
            ? items.length - 1
            : (currentIndex - 1 + items.length) % items.length;
        items[next]?.focus();
      } else if (event.key === "Home") {
        event.preventDefault();
        items[0]?.focus();
      } else if (event.key === "End") {
        event.preventDefault();
        items[items.length - 1]?.focus();
      }
    }

    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    const frame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  async function runAction(action: AiAction) {
    setMenuOpen(false);
    setError(null);
    setCopied(false);
    setBusyAction(action);
    triggerRef.current?.focus();

    try {
      const res = await fetch(`/api/documents/${documentId}/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json()) as {
        result?: string;
        error?: string;
      };

      if (res.status === 429) {
        const retryHeader = res.headers.get("Retry-After");
        const retryAfterSec = retryHeader ? Number(retryHeader) : null;
        setError(
          formatRetryMessage(Number.isFinite(retryAfterSec) ? retryAfterSec : null),
        );
        return;
      }

      if (!res.ok || typeof data.result !== "string") {
        throw new Error(data.error ?? "AI request failed");
      }

      if (action === "summarize") {
        setModal({ kind: "summary", text: data.result });
        return;
      }

      if (action === "rewrite") {
        setModal({
          kind: "rewrite",
          before: currentContent,
          after: data.result,
        });
        return;
      }

      onApplyTitle(data.result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "AI request failed");
    } finally {
      setBusyAction(null);
    }
  }

  async function copySummary(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setError("Could not copy to clipboard");
    }
  }

  const disabledReason = !online
    ? "AI requires network"
    : busyAction
      ? "AI request in progress"
      : undefined;

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-secondary"
        disabled={!online || busyAction !== null}
        title={disabledReason}
        aria-label={busyAction ? "AI working" : "AI tools"}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? menuId : undefined}
        onClick={() => setMenuOpen((open) => !open)}
      >
        {busyAction ? "AI…" : "AI"}
      </button>

      {menuOpen ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="AI actions"
          className="absolute right-0 z-40 mt-2 w-52 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            className="block w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-800 hover:bg-zinc-100 focus-visible:bg-zinc-100"
            onClick={() => void runAction("summarize")}
          >
            Summarize
          </button>
          {canEdit ? (
            <>
              <button
                type="button"
                role="menuitem"
                className="block w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-800 hover:bg-zinc-100 focus-visible:bg-zinc-100"
                onClick={() => void runAction("rewrite")}
              >
                Rewrite
              </button>
              <button
                type="button"
                role="menuitem"
                className="block w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-800 hover:bg-zinc-100 focus-visible:bg-zinc-100"
                onClick={() => void runAction("title")}
              >
                Generate title
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="absolute right-0 top-full z-30 mt-2 w-72 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-950 shadow"
        >
          {error}
          <button
            type="button"
            className="ml-2 font-medium underline"
            onClick={() => setError(null)}
          >
            Dismiss
          </button>
        </p>
      ) : null}

      {modal?.kind === "summary" ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/20"
            aria-label="Close summary"
            onClick={() => setModal(null)}
          />
          <div
            ref={summaryDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-summary-title"
            className="relative w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl"
          >
            <h2 id="ai-summary-title" className="text-lg font-semibold text-zinc-900">
              Summary
            </h2>
            <pre className="mt-3 max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-xl bg-zinc-50 p-4 text-sm leading-6 text-zinc-800">
              {modal.text}
            </pre>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void copySummary(modal.text)}
              >
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setModal(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {modal?.kind === "rewrite" ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/20"
            aria-label="Close rewrite preview"
            onClick={() => setModal(null)}
          />
          <div
            ref={rewriteDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-rewrite-title"
            aria-describedby="ai-rewrite-description"
            className="relative flex max-h-[85vh] w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl"
          >
            <header className="border-b border-zinc-200 px-5 py-4">
              <h2 id="ai-rewrite-title" className="text-lg font-semibold text-zinc-900">
                Rewrite preview
              </h2>
              <p id="ai-rewrite-description" className="mt-0.5 text-xs text-zinc-500">
                Review the AI rewrite, then apply it through normal sync.
              </p>
            </header>
            <div className="grid min-h-0 flex-1 gap-4 overflow-hidden p-5 md:grid-cols-2">
              <div className="min-h-0 overflow-auto rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Current
                </p>
                <pre className="whitespace-pre-wrap text-sm leading-6 text-zinc-700">
                  {modal.before || "(empty)"}
                </pre>
              </div>
              <div className="min-h-0 overflow-auto rounded-xl border border-[#c2d7fc] bg-[#f8fbff] p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#1557b0]">
                  Rewrite
                </p>
                <pre className="whitespace-pre-wrap text-sm leading-6 text-zinc-800">
                  {modal.after}
                </pre>
              </div>
            </div>
            <footer className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-4">
              <button type="button" className="btn btn-ghost" onClick={() => setModal(null)}>
                Discard
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  onApplyRewrite(modal.after);
                  setModal(null);
                }}
              >
                Apply rewrite
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
