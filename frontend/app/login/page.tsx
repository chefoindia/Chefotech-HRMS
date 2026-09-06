"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, Eye, EyeOff, KeyRound, ShieldCheck } from "lucide-react";
import { useSession } from "@/lib/session";
import { ApiError } from "@/lib/api";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { Button, Callout, Input, PageLoader } from "@/components/ui";
import type { Session } from "@/lib/types";

/** Mirrors the server's landing logic (auth.service.landingRouteFor). */
function landingRouteFor(session: Session) {
  if (session.isPlatformUser) return "/platform";
  if (session.passwordExpired) return "/me/security?expired=1";
  if (session.mfaSetupRequired) return "/me/security?setup=1";
  const p = new Set(session.permissions || []);
  if (p.has("dashboard.view_org_wide") || p.has("employee.view")) return "/app";
  if (p.has("workflow.act") || session.isManager) return "/app/approvals";
  return "/me";
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signIn, completeMfa, switchOrganization, session, loading } = useSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [organizations, setOrganizations] = useState<Array<{ id: string; name: string }> | null>(null);
  const [mfa, setMfa] = useState<{ mfaToken: string; useRecovery: boolean; code: string } | null>(null);

  const next = searchParams.get("next");
  // Set the moment sign-in succeeds, so the "already signed in" redirect
  // below does not race the sign-in redirect and send an employee to /app
  // when the server said /me.
  const signedInHere = useRef(false);

  // Already signed in? Do not make them sign in again — and land them where
  // their permissions say, not on a fixed route.
  useEffect(() => {
    if (loading || !session || signedInHere.current) return;
    router.replace(next || landingRouteFor(session));
  }, [loading, session, router, next]);

  const fail = (err: unknown) => {
    if (err instanceof ApiError) setError(err.message);
    else setError("Could not reach the server. Check your connection and try again.");
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const result = await signIn(email, password);

      if (result.mode === "mfa_required" && result.mfaToken) {
        setMfa({ mfaToken: result.mfaToken, useRecovery: false, code: "" });
        return;
      }
      if (result.mode === "select_organization") {
        setOrganizations(result.organizations || []);
        return;
      }

      signedInHere.current = true;
      router.replace(next || result.redirectTo || "/app");
    } catch (err) {
      fail(err);
    } finally {
      setSubmitting(false);
    }
  };

  const submitCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!mfa) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await completeMfa(mfa.mfaToken, mfa.code.trim());
      if (result.mode === "select_organization") {
        setMfa(null);
        setOrganizations(result.organizations || []);
        return;
      }
      signedInHere.current = true;
      router.replace(next || result.redirectTo || "/app");
    } catch (err) {
      if (err instanceof ApiError && err.message.toLowerCase().includes("expired")) {
        // The five-minute window closed: back to the password.
        setMfa(null);
      }
      fail(err);
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Choosing a workspace uses the scoped token the chooser came with rather
   * than re-sending the password — which would repeat the two-factor step
   * for anyone who has one.
   */
  const chooseOrganization = async (organizationId: string) => {
    setError(null);
    setSubmitting(true);
    try {
      await switchOrganization(organizationId);
      // The session effect above routes by permissions once the session lands.
      signedInHere.current = false;
    } catch (err) {
      fail(err);
    } finally {
      setSubmitting(false);
    }
  };

  if (mfa) {
    return (
      <AuthLayout
        title="Two-factor authentication"
        subtitle={mfa.useRecovery ? "Enter one of the recovery codes you saved when you set this up." : "Enter the six-digit code from your authenticator app."}
      >
        <form onSubmit={submitCode} className="space-y-4" noValidate>
          {error && <Callout tone="danger">{error}</Callout>}
          <Input
            label={mfa.useRecovery ? "Recovery code" : "Authentication code"}
            autoFocus
            required
            autoComplete="one-time-code"
            inputMode={mfa.useRecovery ? "text" : "numeric"}
            placeholder={mfa.useRecovery ? "ABCDE-FGHJK" : "123 456"}
            value={mfa.code}
            onChange={(event) => setMfa({ ...mfa, code: event.target.value })}
            prefix={mfa.useRecovery ? <KeyRound className="h-4 w-4 text-[var(--text-subtle)]" /> : <ShieldCheck className="h-4 w-4 text-[var(--text-subtle)]" />}
            className={mfa.useRecovery ? "font-mono uppercase tracking-wider" : "text-[18px] tracking-[0.3em]"}
          />
          <Button type="submit" fullWidth size="lg" loading={submitting} disabled={mfa.code.replace(/\s/g, "").length < 6}>
            Continue
          </Button>
          <div className="flex items-center justify-between text-[12.5px]">
            <button type="button" className="text-[var(--text-muted)] hover:text-brand-600 hover:underline" onClick={() => setMfa({ ...mfa, useRecovery: !mfa.useRecovery, code: "" })}>
              {mfa.useRecovery ? "Use my authenticator app instead" : "Lost your phone? Use a recovery code"}
            </button>
            <button type="button" className="text-[var(--text-muted)] hover:text-brand-600 hover:underline" onClick={() => setMfa(null)}>
              Start over
            </button>
          </div>
        </form>
      </AuthLayout>
    );
  }

  if (organizations) {
    return (
      <AuthLayout title="Choose an organization" subtitle="Your account has access to more than one workspace.">
        <div className="space-y-2">
          {organizations.map((organization) => (
            <button
              key={organization.id}
              type="button"
              disabled={submitting}
              onClick={() => chooseOrganization(organization.id)}
              className="flex w-full items-center gap-3 rounded-[var(--radius)] border p-3.5 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/50 disabled:opacity-60"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-100 text-brand-700">
                <Building2 className="h-4.5 w-4.5" aria-hidden />
              </span>
              <span className="text-[14px] font-medium text-[var(--text)]">{organization.name}</span>
            </button>
          ))}
        </div>
        {error && <Callout tone="danger" className="mt-3">{error}</Callout>}

        <Button variant="ghost" size="sm" className="mt-4" onClick={() => setOrganizations(null)}>
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

        {searchParams.get("reset") === "1" && <Callout tone="success">Your password has been changed. Sign in with the new one.</Callout>}
        {searchParams.get("idle") === "1" && <Callout tone="info">You were signed out after a period of inactivity.</Callout>}

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
            <Link href="/forgot-password" className="text-[12.5px] text-[var(--text-muted)] hover:text-brand-600 hover:underline">
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
