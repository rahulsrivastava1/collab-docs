import Head from "next/head";
import Link from "next/link";

const SITE = {
  name: "Google Docs Clone",
  author: "Rahul Srivastava",
  github: "https://github.com/rahulsrivastava1",
  linkedin: "https://www.linkedin.com/in/rahulsriv/",
} as const;

/** Brand icons — Lucide removed Github/Linkedin brand exports in recent versions. */
function GithubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.866-.014-1.7-2.782.604-3.369-1.342-3.369-1.342-.454-1.154-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0 1 12 6.844c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.161 22 16.416 22 12c0-5.523-4.477-10-10-10Z" />
    </svg>
  );
}

function LinkedinIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

export default function Home() {
  const year = new Date().getFullYear();

  return (
    <>
      <Head>
        <title>{SITE.name}</title>
        <meta
          name="description"
          content="Local-first collaborative document editor with offline sync and version history."
        />
      </Head>

      <div className="flex min-h-screen flex-col bg-zinc-50 text-zinc-900">
        <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-6 py-16">
          <p className="text-sm font-medium tracking-wide text-zinc-500">House of Edtech · Assignment</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">{SITE.name}</h1>
          <p className="mt-4 max-w-xl text-lg leading-relaxed text-zinc-600">
            Local-first collaborative documents with offline sync, deterministic conflict resolution, and version
            history.
          </p>
          <p className="mt-8 text-sm text-zinc-500">
            Scaffold ready · Next.js 16 · TypeScript · Tailwind · Pages Router
          </p>
        </main>

        <footer className="border-t border-zinc-200 bg-white">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 py-4 text-sm text-zinc-600 sm:flex-row sm:items-center sm:justify-between">
            <span>
              © {year}, {SITE.author}
            </span>
            <div className="flex items-center gap-4">
              <Link
                href={SITE.github}
                className="inline-flex items-center gap-1.5 text-zinc-600 transition-colors hover:text-zinc-900"
                target="_blank"
                rel="noopener noreferrer"
              >
                <GithubIcon className="size-4" />
                <span>GitHub</span>
              </Link>
              <Link
                href={SITE.linkedin}
                className="inline-flex items-center gap-1.5 text-zinc-600 transition-colors hover:text-zinc-900"
                target="_blank"
                rel="noopener noreferrer"
              >
                <LinkedinIcon className="size-4" />
                <span>LinkedIn</span>
              </Link>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
