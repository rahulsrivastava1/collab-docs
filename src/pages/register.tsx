import Head from "next/head";
import Link from "next/link";
import { signIn } from "next-auth/react";
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

type FieldErrors = {
  email?: string;
  password?: string;
};

export default function RegisterPage() {
  const router = useRouter();
  const formId = useId();
  const nameId = `${formId}-name`;
  const emailId = `${formId}-email`;
  const passwordId = `${formId}-password`;
  const emailErrorId = `${formId}-email-error`;
  const passwordErrorId = `${formId}-password-error`;
  const passwordHelpId = `${formId}-password-help`;
  const formErrorId = `${formId}-form-error`;

  const [name, setName] = useState("");
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
    else if (password.length < 8) next.password = "At least 8 characters";
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!validate()) return;

    setLoading(true);

    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password }),
    });

    const data = (await response.json()) as { error?: string };

    if (!response.ok) {
      setLoading(false);
      setError(data.error ?? "Could not create account.");
      return;
    }

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError("Account created, but sign-in failed. Try logging in.");
      return;
    }

    await router.push("/");
  }

  const passwordDescribedBy = fieldErrors.password
    ? passwordErrorId
    : passwordHelpId;

  return (
    <>
      <Head>
        <title>Create account · Google Docs Clone</title>
      </Head>
      <div className="flex min-h-screen flex-col bg-zinc-100 text-zinc-900">
        <SiteNav compact />
        <main className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6">
          <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
              Create account
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-zinc-600">
              Register with email and password, or use Google on the sign-in page.
            </p>

            <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
              <div>
                <label htmlFor={nameId} className="block text-sm font-medium text-zinc-800">
                  Name
                </label>
                <input
                  id={nameId}
                  type="text"
                  autoComplete="name"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={fieldClass(false)}
                />
              </div>
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
                <label htmlFor={passwordId} className="block text-sm font-medium text-zinc-800">
                  Password <span className="text-red-600">*</span>
                </label>
                <PasswordInput
                  id={passwordId}
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(value) => {
                    setPassword(value);
                    if (fieldErrors.password) {
                      setFieldErrors((prev) => ({ ...prev, password: undefined }));
                    }
                  }}
                  className={fieldClass(Boolean(fieldErrors.password))}
                  aria-invalid={Boolean(fieldErrors.password)}
                  aria-describedby={passwordDescribedBy}
                />
                {fieldErrors.password ? (
                  <span
                    id={passwordErrorId}
                    role="alert"
                    className="mt-1.5 block text-xs font-medium text-red-600"
                  >
                    {fieldErrors.password}
                  </span>
                ) : (
                  <span
                    id={passwordHelpId}
                    className="mt-1.5 block text-xs font-medium text-zinc-500"
                  >
                    At least 8 characters
                  </span>
                )}
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
                {loading ? "Creating…" : "Create account"}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-zinc-600">
              Already have an account?{" "}
              <Link href="/login" className="font-semibold text-[#1a73e8] hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        </main>
      </div>
    </>
  );
}
