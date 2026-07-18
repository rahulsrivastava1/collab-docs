import { useEffect, useRef, useState, type FormEvent } from "react";
import type { DocumentRole } from "@/lib/acl";
import { useDialogFocus } from "@/lib/use-dialog-focus";

type Member = {
  user_id: string;
  role: DocumentRole;
  name: string | null;
  email: string;
  image: string | null;
};

type ShareModalProps = {
  documentId: string;
  open: boolean;
  onClose: () => void;
};

export function ShareModal({ documentId, open, onClose }: ShareModalProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useDialogFocus(dialogRef, {
    open,
    onClose,
    initialFocusRef: emailRef,
  });

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    async function load() {
      setLoadingMembers(true);
      setError(null);
      try {
        const res = await fetch(`/api/documents/${documentId}/members`);
        const data = (await res.json()) as { members?: Member[]; error?: string };
        if (!cancelled) {
          if (!res.ok) setError(data.error ?? "Could not load members");
          else setMembers(data.members ?? []);
        }
      } finally {
        if (!cancelled) setLoadingMembers(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [documentId, open]);

  if (!open) return null;

  async function onInvite(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`/api/documents/${documentId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role }),
      });

      let data: { member?: Member; error?: string } = {};
      try {
        data = (await res.json()) as { member?: Member; error?: string };
      } catch {
        data = { error: "Invalid server response" };
      }

      if (!res.ok) {
        setError(data.error ?? "Could not share document");
        return;
      }

      if (data.member) {
        setMembers((prev) => {
          const without = prev.filter((m) => m.user_id !== data.member!.user_id);
          return [...without, data.member!].sort((a, b) => {
            const order = { owner: 0, editor: 1, viewer: 2 };
            return order[a.role] - order[b.role];
          });
        });
      }
      setEmail("");
      emailRef.current?.focus();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function onChangeRole(userId: string, nextRole: "editor" | "viewer") {
    setError(null);
    const res = await fetch(`/api/documents/${documentId}/members/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: nextRole }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(data.error ?? "Could not update role");
      return;
    }
    setMembers((prev) =>
      prev.map((m) => (m.user_id === userId ? { ...m, role: nextRole } : m)),
    );
  }

  async function onRemove(userId: string) {
    setError(null);
    const res = await fetch(`/api/documents/${documentId}/members/${userId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      setError(data.error ?? "Could not remove member");
      return;
    }
    setMembers((prev) => prev.filter((m) => m.user_id !== userId));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-title"
        aria-describedby="share-description"
        className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl sm:p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="share-title" className="text-xl font-semibold text-zinc-900">
              Share document
            </h2>
            <p id="share-description" className="mt-1 text-sm text-zinc-600">
              Invite by email. They must already have an account.
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
            Close
          </button>
        </div>

        <form onSubmit={onInvite} className="mt-5 flex flex-col gap-3 sm:flex-row">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Email address</span>
            <input
              ref={emailRef}
              type="email"
              required
              placeholder="colleague@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field"
              style={{ height: "var(--btn-height)", paddingTop: 0, paddingBottom: 0 }}
            />
          </label>
          <label>
            <span className="sr-only">Role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "editor" | "viewer")}
              className="select w-full sm:w-auto"
            >
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
          <button type="submit" disabled={loading} className="btn btn-primary">
            {loading ? "Sharing…" : "Share"}
          </button>
        </form>

        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-5">
          <h3 className="text-sm font-semibold text-zinc-800">People with access</h3>
          {loadingMembers ? (
            <p className="mt-3 text-sm text-zinc-500" role="status">
              Loading…
            </p>
          ) : members.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">No members yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-zinc-100">
              {members.map((member) => (
                <li
                  key={member.user_id}
                  className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-900">
                      {member.name || member.email}
                    </p>
                    <p className="truncate text-xs text-zinc-500">{member.email}</p>
                  </div>
                  {member.role === "owner" ? (
                    <span className="text-sm font-medium text-zinc-600">Owner</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <label>
                        <span className="sr-only">
                          Role for {member.name || member.email}
                        </span>
                        <select
                          value={member.role}
                          onChange={(e) =>
                            void onChangeRole(
                              member.user_id,
                              e.target.value as "editor" | "viewer",
                            )
                          }
                          className="select select-sm"
                        >
                          <option value="editor">Editor</option>
                          <option value="viewer">Viewer</option>
                        </select>
                      </label>
                      <button
                        type="button"
                        onClick={() => void onRemove(member.user_id)}
                        className="btn btn-ghost btn-sm text-red-700 hover:bg-red-50"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
