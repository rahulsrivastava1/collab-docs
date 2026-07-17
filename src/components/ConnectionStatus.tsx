import { useSync } from "@/components/SyncProvider";

export function ConnectionStatus() {
  const { online, status, pendingCount, error } = useSync();

  let label = "Online";
  let tone = "bg-emerald-50 text-emerald-700";
  let dot = "bg-emerald-500";

  if (!online || status === "offline") {
    label = "Offline";
    tone = "bg-amber-50 text-amber-800";
    dot = "bg-amber-500";
  } else if (status === "syncing") {
    label = "Syncing";
    tone = "bg-sky-50 text-sky-800";
    dot = "bg-sky-500";
  } else if (status === "error") {
    label = "Sync error";
    tone = "bg-red-50 text-red-700";
    dot = "bg-red-500";
  } else if (status === "synced" || status === "idle") {
    label = "Synced";
    tone = "bg-emerald-50 text-emerald-700";
    dot = "bg-emerald-500";
  }

  return (
    <div className="inline-flex max-w-[220px] flex-col items-end gap-0.5 text-xs font-medium">
      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${tone}`}>
        <span className={`size-1.5 rounded-full ${dot}`} aria-hidden />
        {label}
        {pendingCount > 0 ? ` · ${pendingCount} pending` : null}
      </span>
      {error ? (
        <span className="truncate text-[10px] font-medium text-red-600" title={error}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
