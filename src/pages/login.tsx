import Head from "next/head";
import Link from "next/link";
import { signIn } from "next-auth/react";
import type { FormEvent } from "react";
import { useId, useState } from "react";
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
  const formId = useId();
  const emailId = `${formId}-email`;
  const passwordId = `${formId}-password`;
  const emailErrorId = `${formId}-email-error`;
  const passwordErrorId = `${formId}-password-error`;
  const formErrorId = `${formId}-form-error`;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);
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
    setNeedsVerification(false);

    if (!validate()) return;

    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      if (result.error === "EMAIL_NOT_VERIFIED") {
        setNeedsVerification(true);
        setError("Verify your email before signing in.");
        return;
      }
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
        <main className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6">
          <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
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

            <div
              className="my-6 flex items-center gap-3 text-xs font-medium tracking-wide text-zinc-500"
              role="separator"
              aria-label="Or continue with email"
            >
              <div className="h-px flex-1 bg-zinc-200" />
              OR
              <div className="h-px flex-1 bg-zinc-200" />
            </div>

            <form onSubmit={onSubmit} noValidate className="space-y-4">
              <div>
                <label htmlFor={emailId} className="block text-sm font-medium text-zinc-800">
                  Email <span className="text-red-600">*</span>
                </label>
                <input
                  id={emailId}
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
                  aria-describedby={fieldErrors.email ? emailErrorId : undefined}
                  required
                />
                {fieldErrors.email ? (
                  <span
                    id={emailErrorId}
                    role="alert"
                    className="mt-1.5 block text-xs font-medium text-red-600"
                  >
                    {fieldErrors.email}
                  </span>
                ) : null}
              </div>
              <div>
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor={passwordId} className="block text-sm font-medium text-zinc-800">
                    Password <span className="text-red-600">*</span>
                  </label>
                  <Link
                    href="/forgot-password"
                    className="text-xs font-semibold text-[#1a73e8] hover:underline"
                  >
                    Forgot password?
                  </Link>
                </div>
                <PasswordInput
                  id={passwordId}
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
                  aria-describedby={fieldErrors.password ? passwordErrorId : undefined}
                />
                {fieldErrors.password ? (
                  <span
                    id={passwordErrorId}
                    role="alert"
                    className="mt-1.5 block text-xs font-medium text-red-600"
                  >
                    {fieldErrors.password}
                  </span>
                ) : null}
              </div>

              {error ? (
                <div
                  id={formErrorId}
                  role="alert"
                  className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700"
                >
                  <p>{error}</p>
                  {needsVerification ? (
                    <p className="mt-1.5 font-normal">
                      <Link
                        href={{
                          pathname: "/verify-email",
                          query: { email: email.trim().toLowerCase() },
                        }}
                        className="font-semibold underline"
                      >
                        Enter verification code
                      </Link>
                    </p>
                  ) : null}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={loading}
                className="btn btn-primary btn-block"
                aria-busy={loading}
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
