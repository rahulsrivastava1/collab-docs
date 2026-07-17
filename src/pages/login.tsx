import Head from "next/head";
import Link from "next/link";
import { signIn } from "next-auth/react";
import type { FormEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/router";
import { SiteNav } from "@/components/SiteNav";
import { GoogleIcon } from "@/components/GoogleIcon";
import { PasswordInput } from "@/components/PasswordInput";

function fieldClass(hasError: boolean) {
  return [
    "mt-1.5 w-full rounded-lg border bg-white px-3.5 py-2.5 text-[15px] text-zinc-900 placeholder:text-zinc-400 outline-none transition",
    hasError
      ? "border-red-500 focus:border-red-500 focus:ring-2 focus:ring-red-200"
      : "border-zinc-300 focus:border-[#1a73e8] focus:ring-2 focus:ring-[#1a73e8]/30",
  ].join(" ");
}

type FieldErrors = {
  email?: string;
  password?: string;
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function validate() {
    const next: FieldErrors = {};
    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      next.email = "This is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      next.email = "Enter a valid email address";
    }

    if (!password) next.password = "This is required";
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!validate()) return;

    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError("Invalid email or password.");
      return;
    }

    await router.push("/");
  }

  return (
    <>
      <Head>
        <title>Sign in · Google Docs Clone</title>
      </Head>
      <div className="flex min-h-screen flex-col bg-zinc-100 text-zinc-900">
        <SiteNav compact />
        <main className="flex flex-1 items-center justify-center px-6 py-12">
          <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Sign in</h1>
            <p className="mt-2 text-sm leading-relaxed text-zinc-600">
              Use Google or your email and password.
            </p>

            <button
              type="button"
              onClick={() => signIn("google", { callbackUrl: "/" })}
              className="btn btn-secondary btn-block mt-6 gap-3"
            >
              <GoogleIcon className="size-5 shrink-0" />
              Continue with Google
            </button>

            <div className="my-6 flex items-center gap-3 text-xs font-medium tracking-wide text-zinc-500">
              <div className="h-px flex-1 bg-zinc-200" />
              OR
              <div className="h-px flex-1 bg-zinc-200" />
            </div>

            <form onSubmit={onSubmit} noValidate className="space-y-4">
              <label className="block text-sm font-medium text-zinc-800">
                Email <span className="text-red-600">*</span>
                <input
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (fieldErrors.email) {
                      setFieldErrors((prev) => ({ ...prev, email: undefined }));
                    }
                  }}
                  className={fieldClass(Boolean(fieldErrors.email))}
                  aria-invalid={Boolean(fieldErrors.email)}
                />
                {fieldErrors.email ? (
                  <span className="mt-1.5 block text-xs font-medium text-red-600">
                    {fieldErrors.email}
                  </span>
                ) : null}
              </label>
              <label className="block text-sm font-medium text-zinc-800">
                Password <span className="text-red-600">*</span>
                <PasswordInput
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(value) => {
                    setPassword(value);
                    if (fieldErrors.password) {
                      setFieldErrors((prev) => ({ ...prev, password: undefined }));
                    }
                  }}
                  className={fieldClass(Boolean(fieldErrors.password))}
                  aria-invalid={Boolean(fieldErrors.password)}
                />
                {fieldErrors.password ? (
                  <span className="mt-1.5 block text-xs font-medium text-red-600">
                    {fieldErrors.password}
                  </span>
                ) : null}
              </label>

              {error ? (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={loading}
                className="btn btn-primary btn-block"
              >
                {loading ? "Signing in…" : "Sign in"}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-zinc-600">
              No account?{" "}
              <Link href="/register" className="font-semibold text-[#1a73e8] hover:underline">
                Create one
              </Link>
            </p>
          </div>
        </main>
      </div>
    </>
  );
}
