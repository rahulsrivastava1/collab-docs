import Link from "next/link";
import { useRouter } from "next/router";
import { signOut, useSession } from "next-auth/react";

const SITE_NAME = "Google Docs Clone";

type SiteNavProps = {
  compact?: boolean;
};

export function SiteNav({ compact = false }: SiteNavProps) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const path = router.pathname;

  const isLogin = path === "/login";
  const isRegister = path === "/register";

  const inactiveClass = "btn btn-ghost";
  const activeClass = "btn btn-primary";

  const displayName = session?.user?.name || session?.user?.email || "User";
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white">
      <div
        className={`mx-auto flex w-full items-center justify-between px-6 ${
          compact ? "max-w-lg py-3" : "max-w-5xl py-3"
        }`}
      >
        <Link href="/" className="group flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-[#1a73e8] text-sm font-bold !text-white shadow-sm">
            D
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-zinc-900 group-hover:text-zinc-700">
            {SITE_NAME}
          </span>
        </Link>

        <nav className="flex items-center gap-3">
          {status === "loading" ? (
            <span className="text-sm text-zinc-500">Loading…</span>
          ) : session?.user ? (
            <>
              <Link
                href="/docs"
                className={
                  path.startsWith("/docs") ? "btn btn-secondary" : "btn btn-ghost"
                }
              >
                Docs
              </Link>
              <div className="inline-flex h-9 items-center gap-2 rounded-full bg-zinc-100 py-0 pl-1 pr-3">
                {session.user.image ? (
                  <img
                    src={session.user.image}
                    alt=""
                    className="size-7 rounded-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span className="flex size-7 items-center justify-center rounded-full bg-zinc-300 text-xs font-semibold text-zinc-700">
                    {initial}
                  </span>
                )}
                <span className="max-w-[140px] truncate text-sm font-medium text-zinc-900 sm:max-w-[200px]">
                  {displayName}
                </span>
              </div>
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: "/" })}
                className="btn btn-secondary btn-pill"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                aria-current={isLogin ? "page" : undefined}
                className={isLogin ? activeClass : inactiveClass}
              >
                Sign in
              </Link>
              <Link
                href="/register"
                aria-current={isRegister ? "page" : undefined}
                className={isRegister ? activeClass : inactiveClass}
              >
                Register
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
