import Head from "next/head";
import Link from "next/link";
import type { FormEvent } from "react";
import { useId, useState } from "react";
import { useRouter } from "next/router";
import { SiteNav } from "@/components/SiteNav";
import { PasswordInput } from "@/components/PasswordInput";

function fieldClass(hasError: boolean) {
  return [
    "mt-1.5 w-full rounded-lg border bg-white px-3.5 py-2.5 text-[15px] text-zinc-900 placeholder:text-zinc-400 outline-none transition",
    hasError
      ? "border-red-500 focus:border-red-500 focus:ring-2 focus:ring-red-200"
      : "border-zinc-300 focus:border-[#1a73e8] focus:ring-2 focus:ring-[#1a73e8]/30",
  ].join(" ");
}

type Step = "request" | "reset";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const formId = useId();
  const emailId = `${formId}-email`;
  const codeId = `${formId}-code`;
  const passwordId = `${formId}-password`;
  const formErrorId = `${formId}-error`;

  const [step, setStep] = useState<Step>("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onRequestCode(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setStatus(null);

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("Enter a valid email address.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmedEmail }),
      });
      const data = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not send reset code.");
        return;
      }
      setEmail(trimmedEmail);
      setStatus(data.message ?? "If an account exists, we sent a reset code.");
      setStep("reset");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function onResetPassword(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setStatus(null);

    if (!/^\d{6}$/.test(code.trim())) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          code: code.trim(),
          password,
        }),
      });
      const data = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not reset password.");
        return;
      }
      setStatus(data.message ?? "Password updated.");
      await router.push("/login");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Head>
        <title>Forgot password · Google Docs Clone</title>
      </Head>
      <div className="flex min-h-screen flex-col bg-zinc-100 text-zinc-900">
        <SiteNav compact />
        <main className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6">
          <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
              {step === "request" ? "Forgot password" : "Reset password"}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-zinc-600">
              {step === "request"
                ? "Enter your email and we will send a 6-digit reset code if a password account exists. Google sign-in accounts should continue with Google."
                : "Enter the code from your email and choose a new password."}
            </p>

            {step === "request" ? (
              <form onSubmit={onRequestCode} noValidate className="mt-6 space-y-4">
                <div>
                  <label htmlFor={emailId} className="block text-sm font-medium text-zinc-800">
                    Email
                  </label>
                  <input
                    id={emailId}
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={fieldClass(false)}
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

                <button
                  type="submit"
                  disabled={loading}
                  className="btn btn-primary btn-block"
                  aria-busy={loading}
                >
                  {loading ? "Sending…" : "Send reset code"}
                </button>
              </form>
            ) : (
              <form onSubmit={onResetPassword} noValidate className="mt-6 space-y-4">
                <div>
                  <label htmlFor={emailId} className="block text-sm font-medium text-zinc-800">
                    Email
                  </label>
                  <input
                    id={emailId}
                    type="email"
                    value={email}
                    readOnly
                    className={`${fieldClass(false)} bg-zinc-50`}
                  />
                </div>
                <div>
                  <label htmlFor={codeId} className="block text-sm font-medium text-zinc-800">
                    Reset code
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
                <div>
                  <label htmlFor={passwordId} className="block text-sm font-medium text-zinc-800">
                    New password
                  </label>
                  <PasswordInput
                    id={passwordId}
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    value={password}
                    onChange={setPassword}
                    className={fieldClass(false)}
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
                  {loading ? "Updating…" : "Update password"}
                </button>

                <button
                  type="button"
                  className="btn btn-ghost btn-block"
                  onClick={() => {
                    setStep("request");
                    setCode("");
                    setPassword("");
                    setError(null);
                    setStatus(null);
                  }}
                >
                  Use a different email
                </button>
              </form>
            )}

            <p className="mt-6 text-center text-sm text-zinc-600">
              <Link href="/login" className="font-semibold text-[#1a73e8] hover:underline">
                Back to sign in
              </Link>
            </p>
          </div>
        </main>
      </div>
    </>
  );
}
