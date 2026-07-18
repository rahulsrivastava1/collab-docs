import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { PresencePeer } from "@/lib/realtime-bus";

function displayName(peer: PresencePeer) {
  const name = peer.name?.trim();
  if (name) return name;
  return "Someone";
}

type PresenceBarProps = {
  peers: PresencePeer[];
  connected: boolean;
};

export function PresenceBar({ peers, connected }: PresenceBarProps) {
  if (!connected && peers.length === 0) {
    return null;
  }

  if (peers.length === 0) {
    return connected ? (
      <span className="text-xs text-zinc-500" role="status">
        Only you here
      </span>
    ) : null;
  }

  const summary = peers
    .map((peer) => {
      const name = displayName(peer);
      return peer.mode === "editing" ? `${name} (typing)` : name;
    })
    .join(", ");

  return (
    <div
      className="flex items-center -space-x-2"
      role="status"
      aria-live="polite"
      aria-label={`${peers.length} other ${peers.length === 1 ? "person" : "people"}: ${summary}`}
    >
      {peers.slice(0, 5).map((peer) => {
        const name = displayName(peer);
        const initial = name.charAt(0).toUpperCase();
        const label = `${name}${peer.mode === "editing" ? " (typing)" : ""}`;
        return (
          <span
            key={peer.userId}
            title={label}
            className={`relative inline-flex size-8 items-center justify-center overflow-hidden rounded-full border-2 border-white text-xs font-semibold shadow-sm ${
              peer.mode === "editing"
                ? "bg-[#1a73e8] text-white ring-2 ring-[#1a73e8]/30"
                : "bg-zinc-200 text-zinc-700"
            }`}
          >
            {peer.image ? (
              <img src={peer.image} alt="" className="size-full object-cover" />
            ) : (
              <span aria-hidden>{initial}</span>
            )}
          </span>
        );
      })}
      {peers.length > 5 ? (
        <span
          className="inline-flex size-8 items-center justify-center rounded-full border-2 border-white bg-zinc-100 text-[10px] font-semibold text-zinc-600"
          aria-hidden
        >
          +{peers.length - 5}
        </span>
      ) : null}
    </div>
  );
}

/** Exact caret x/y inside a textarea (line + column). */
function getCaretPosition(
  textarea: HTMLTextAreaElement,
  caret: number,
): { top: number; left: number } {
  const value = textarea.value;
  const clamped = Math.max(0, Math.min(caret, value.length));
  const style = window.getComputedStyle(textarea);

  let lineHeight = parseFloat(style.lineHeight);
  if (!Number.isFinite(lineHeight) || style.lineHeight === "normal") {
    lineHeight = (parseFloat(style.fontSize) || 15) * 1.75;
  }

  const paddingTop = parseFloat(style.paddingTop) || 0;
  const paddingLeft = parseFloat(style.paddingLeft) || 0;

  const before = value.slice(0, clamped);
  const lineIndex = before.split("\n").length - 1;
  const lineStart = before.lastIndexOf("\n") + 1;
  const colText = before.slice(lineStart);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  let colWidth = 0;
  if (ctx) {
    const weight = style.fontWeight || "400";
    const size = style.fontSize || "15px";
    const family = style.fontFamily || "sans-serif";
    ctx.font = `${weight} ${size} ${family}`;
    colWidth = ctx.measureText(colText.replace(/\t/g, "    ")).width;
  }

  return {
    top: paddingTop + lineIndex * lineHeight - textarea.scrollTop,
    left: paddingLeft + colWidth - textarea.scrollLeft,
  };
}

type LineLabel = {
  userId: string;
  name: string;
  image: string | null;
  top: number;
  left: number;
};

type EditorTypingIndicatorProps = {
  editingPeers: PresencePeer[];
  textareaRef: RefObject<HTMLTextAreaElement | null>;
};

/**
 * Avatar + name at the remote caret (where they are typing), not at line start.
 */
export function EditorTypingIndicator({
  editingPeers,
  textareaRef,
}: EditorTypingIndicatorProps) {
  const [labels, setLabels] = useState<LineLabel[]>([]);
  const lastCaretRef = useRef<Map<string, number>>(new Map());

  const peerKey = useMemo(
    () =>
      editingPeers
        .map((p) => `${p.userId}:${p.caret ?? ""}:${p.name ?? ""}:${p.image ?? ""}`)
        .sort()
        .join("|"),
    [editingPeers],
  );

  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta || editingPeers.length === 0) {
      setLabels([]);
      return;
    }

    const activeIds = new Set(editingPeers.map((p) => p.userId));
    for (const id of [...lastCaretRef.current.keys()]) {
      if (!activeIds.has(id)) lastCaretRef.current.delete(id);
    }

    function measure(): LineLabel[] {
      const next: LineLabel[] = [];
      for (const peer of editingPeers) {
        let caret = typeof peer.caret === "number" ? peer.caret : null;
        if (caret == null) {
          caret = lastCaretRef.current.get(peer.userId) ?? null;
        } else {
          lastCaretRef.current.set(peer.userId, caret);
        }
        if (caret == null) continue;

        const { top, left } = getCaretPosition(ta!, caret);
        const maxTop = Math.max(0, ta!.clientHeight - 28);
        const maxLeft = Math.max(8, ta!.clientWidth - 120);

        next.push({
          userId: peer.userId,
          name: displayName(peer),
          image: peer.image,
          // Name chip sits just above the caret so the typed char stays visible
          top: Math.min(maxTop, Math.max(0, top - 18)),
          left: Math.min(maxLeft, Math.max(8, left)),
        });
      }
      return next;
    }

    setLabels(measure());

    const onScroll = () => setLabels(measure());
    ta.addEventListener("scroll", onScroll);
    return () => ta.removeEventListener("scroll", onScroll);
  }, [peerKey, editingPeers, textareaRef]);

  if (labels.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
      aria-live="polite"
      aria-atomic="false"
    >
      {labels.map((label) => {
        const initial = label.name.charAt(0).toUpperCase();
        return (
          <div
            key={label.userId}
            className="absolute flex flex-col items-start"
            style={{ top: label.top, left: label.left }}
            aria-label={`${label.name} is typing`}
          >
            <div className="flex items-center gap-1">
              <span
                className="inline-flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#1a73e8] text-[10px] font-bold text-white shadow-sm ring-2 ring-white"
                aria-hidden
              >
                {label.image ? (
                  <img src={label.image} alt="" className="size-full object-cover" />
                ) : (
                  initial
                )}
              </span>
              <span
                className="rounded bg-[#1a73e8] px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white shadow-sm"
                aria-hidden
              >
                {label.name}
              </span>
            </div>
            <div className="ml-[9px] mt-0.5 h-[1.15em] w-0.5 bg-[#1a73e8]" aria-hidden />
          </div>
        );
      })}
    </div>
  );
}
