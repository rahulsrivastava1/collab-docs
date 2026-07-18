import { useSync } from "@/components/SyncProvider";

export function ConnectionStatus() {
  const { online, status, pendingCount, error } = useSync();

  let label = "Online";
  let tone = "bg-emerald-50 text-emerald-800";
  let dot = "bg-emerald-600";

  if (!online || status === "offline") {
    label = "Offline";
    tone = "bg-amber-50 text-amber-900";
    dot = "bg-amber-600";
  } else if (status === "syncing") {
    label = "Syncing";
    tone = "bg-sky-50 text-sky-900";
    dot = "bg-sky-600";
  } else if (status === "error") {
    label = "Sync error";
    tone = "bg-red-50 text-red-800";
    dot = "bg-red-600";
  } else if (status === "synced" || status === "idle") {
    label = "Synced";
    tone = "bg-emerald-50 text-emerald-800";
    dot = "bg-emerald-600";
  }

  const pendingSuffix = pendingCount > 0 ? ` · ${pendingCount} pending` : "";
  const announcement = error ? `${label}${pendingSuffix}. ${error}` : `${label}${pendingSuffix}`;

  return (
    <div
      className="inline-flex max-w-[220px] flex-col items-end gap-0.5 text-xs font-medium"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${tone}`}>
        <span className={`size-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />
        <span>
          {label}
          {pendingSuffix}
        </span>
      </span>
      {error ? (
        <span className="max-w-full truncate text-[10px] font-medium text-red-700" title={error}>
          {error}
        </span>
      ) : null}
      <span className="sr-only">{announcement}</span>
    </div>
  );
}
