"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, Eye, EyeOff } from "lucide-react";
import { useSession } from "@/lib/session";
import { ApiError } from "@/lib/api";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { Button, Callout, Input, PageLoader } from "@/components/ui";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signIn, session, loading } = useSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [organizations, setOrganizations] = useState<Array<{ id: string; name: string }> | null>(null);

  const next = searchParams.get("next");

  // Already signed in? Do not make them sign in again.
  useEffect(() => {
    if (!loading && session) router.replace(next || "/app");
  }, [loading, session, router, next]);

  const submit = async (event: React.FormEvent, organizationId?: string) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const result = await signIn(email, password, organizationId);

      if (result.mode === "select_organization") {
        setOrganizations(result.organizations || []);
        return;
      }

      router.push(next || result.redirectTo || "/app");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Could not reach the server. Check your connection and try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (organizations) {
    return (
      <AuthLayout
        title="Choose an organization"
        subtitle="Your account has access to more than one workspace."
      >
        <div className="space-y-2">
          {organizations.map((organization) => (
            <button
              key={organization.id}
              type="button"
              disabled={submitting}
              onClick={(event) => submit(event as unknown as React.FormEvent, organization.id)}
              className="flex w-full items-center gap-3 rounded-[var(--radius)] border p-3.5 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/50 disabled:opacity-60"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-100 text-brand-700">
                <Building2 className="h-4.5 w-4.5" aria-hidden />
              </span>
              <span className="text-[14px] font-medium text-[var(--text)]">{organization.name}</span>
            </button>
          ))}
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="mt-4"
          onClick={() => setOrganizations(null)}
        >
          Use a different account
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Welcome back. Enter your details to continue."
      footer={
        <>
          New to Chefotech?{" "}
          <Link href="/register" className="font-medium text-brand-600 hover:underline">
            Create an organization
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Callout tone="danger">{error}</Callout>}

        {searchParams.get("reset") === "1" && (
          <Callout tone="success">Your password has been changed. Sign in with the new one.</Callout>
        )}

        <Input
          label="Work email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@company.com"
        />

        <div>
          <Input
            label="Password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
            suffix={
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="pointer-events-auto text-[var(--text-subtle)] hover:text-[var(--text)]"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            }
          />
          <div className="mt-1.5 text-right">
            <Link
              href="/forgot-password"
              className="text-[12.5px] text-[var(--text-muted)] hover:text-brand-600 hover:underline"
            >
              Forgot your password?
            </Link>
          </div>
        </div>

        <Button type="submit" fullWidth size="lg" loading={submitting}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <LoginForm />
    </Suspense>
  );
}
