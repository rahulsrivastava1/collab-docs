import Head from "next/head";
import Link from "next/link";
import type { FormEvent } from "react";
import { useEffect, useId, useState } from "react";
import { useRouter } from "next/router";
import { SiteNav } from "@/components/SiteNav";

function fieldClass(hasError: boolean) {
  return [
    "mt-1.5 w-full rounded-lg border bg-white px-3.5 py-2.5 text-[15px] text-zinc-900 placeholder:text-zinc-400 outline-none transition",
    hasError
      ? "border-red-500 focus:border-red-500 focus:ring-2 focus:ring-red-200"
      : "border-zinc-300 focus:border-[#1a73e8] focus:ring-2 focus:ring-[#1a73e8]/30",
  ].join(" ");
}

export default function VerifyEmailPage() {
  const router = useRouter();
  const formId = useId();
  const emailId = `${formId}-email`;
  const codeId = `${formId}-code`;
  const formErrorId = `${formId}-error`;

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (!router.isReady) return;
    const q = router.query.email;
    if (typeof q === "string" && q.trim()) {
      setEmail(q.trim().toLowerCase());
    }
  }, [router.isReady, router.query.email]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setStatus(null);

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !/^\d{6}$/.test(code.trim())) {
      setError("Enter your email and the 6-digit code.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmedEmail, code: code.trim() }),
      });
      const data = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not verify email.");
        return;
      }
      setStatus(data.message ?? "Email verified.");
      await router.push("/login");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function onResend() {
    setError(null);
    setStatus(null);
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setError("Enter your email first.");
      return;
    }

    setResending(true);
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmedEmail }),
      });
      const data = (await res.json()) as {
        error?: string;
        message?: string;
        retryAfterSec?: number;
      };
      if (res.status === 429) {
        const wait = data.retryAfterSec ?? 60;
        setCooldown(wait);
        setError(data.error ?? `Please wait ${wait}s before requesting another code.`);
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "Could not resend code.");
        return;
      }
      setCooldown(60);
      setStatus(data.message ?? "If an account needs verification, we sent a code.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setResending(false);
    }
  }

  return (
    <>
      <Head>
        <title>Verify email · Google Docs Clone</title>
      </Head>
      <div className="flex min-h-screen flex-col bg-zinc-100 text-zinc-900">
        <SiteNav compact />
        <main className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6">
          <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
              Verify your email
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-zinc-600">
              Enter the 6-digit code we sent. Codes expire in 10 minutes.
            </p>

            <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
              <div>
                <label htmlFor={emailId} className="block text-sm font-medium text-zinc-800">
                  Email
                </label>
                <input
                  id={emailId}
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={fieldClass(false)}
                  required
                />
              </div>
              <div>
                <label htmlFor={codeId} className="block text-sm font-medium text-zinc-800">
                  Verification code
                </label>
                <input
                  id={codeId}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className={`${fieldClass(false)} tracking-[0.3em]`}
                  required
                />
              </div>

              {error ? (
                <p
                  id={formErrorId}
                  role="alert"
                  className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700"
                >
                  {error}
                </p>
              ) : null}
              {status ? (
                <p
                  role="status"
                  className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800"
                >
                  {status}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={loading}
                className="btn btn-primary btn-block"
                aria-busy={loading}
              >
                {loading ? "Verifying…" : "Verify email"}
              </button>
            </form>

            <div className="mt-4 flex flex-col gap-2 text-center text-sm text-zinc-600">
              <button
                type="button"
                onClick={() => void onResend()}
                disabled={resending || cooldown > 0}
                className="font-semibold text-[#1a73e8] hover:underline disabled:cursor-not-allowed disabled:opacity-60 disabled:no-underline"
              >
                {cooldown > 0
                  ? `Resend code in ${cooldown}s`
                  : resending
                    ? "Sending…"
                    : "Resend code"}
              </button>
              <Link href="/login" className="font-semibold text-[#1a73e8] hover:underline">
                Back to sign in
              </Link>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
