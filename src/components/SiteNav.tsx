import Link from "next/link";
import { useRouter } from "next/router";
import { signOut, useSession } from "next-auth/react";
import { ConnectionStatus } from "@/components/ConnectionStatus";

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
  const isDocs = path.startsWith("/docs");

  const inactiveClass = "btn btn-ghost";
  const activeClass = "btn btn-primary";

  const displayName = session?.user?.name || session?.user?.email || "User";
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white">
      <div
        className={`mx-auto flex w-full items-center justify-between gap-2 px-4 sm:gap-3 sm:px-6 ${
          compact ? "max-w-lg py-3" : "max-w-5xl py-3"
        }`}
      >
        <Link
          href="/"
          className="group flex min-w-0 items-center gap-2 sm:gap-2.5"
          aria-label={`${SITE_NAME} home`}
        >
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#1a73e8] text-sm font-bold !text-white shadow-sm"
            aria-hidden
          >
            D
          </span>
          <span className="truncate text-[15px] font-semibold tracking-tight text-zinc-900 group-hover:text-zinc-700">
            {SITE_NAME}
          </span>
        </Link>

        <nav
          className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2"
          aria-label="Account"
        >
          {status === "loading" ? (
            <span className="text-sm text-zinc-500" role="status">
              Loading…
            </span>
          ) : session?.user ? (
            <>
              <ConnectionStatus />
              <Link
                href="/docs"
                aria-current={isDocs ? "page" : undefined}
                className={isDocs ? "btn btn-secondary" : inactiveClass}
              >
                Docs
              </Link>
              <div
                className="inline-flex h-9 max-w-[min(100%,11rem)] items-center gap-2 rounded-full bg-zinc-100 py-0 pl-1 pr-2.5 sm:max-w-[14rem] sm:pr-3"
                title={displayName}
              >
                {session.user.image ? (
                  <img
                    src={session.user.image}
                    alt=""
                    className="size-7 shrink-0 rounded-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <span
                    className="flex size-7 shrink-0 items-center justify-center rounded-full bg-zinc-300 text-xs font-semibold text-zinc-700"
                    aria-hidden
                  >
                    {initial}
                  </span>
                )}
                <span className="truncate text-sm font-medium text-zinc-900">
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
