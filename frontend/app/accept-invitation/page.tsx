"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { api, ApiError, tokens } from "@/lib/api";
import { useSession } from "@/lib/session";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { Button, Callout, Input, PageLoader } from "@/components/ui";

function AcceptForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refresh } = useSession();
  const token = searchParams.get("token") || "";

  const [form, setForm] = useState({ firstName: "", lastName: "", password: "", confirm: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (form.password !== form.confirm) {
      setError("The two passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const { data } = await api.post<{
        accessToken: string;
        refreshToken: string;
        redirectTo?: string;
      }>(
        "/auth/accept-invitation",
        {
          token,
          password: form.password,
          firstName: form.firstName || undefined,
          lastName: form.lastName || undefined,
        },
        { raw: true }
      );

      tokens.set(data.accessToken, data.refreshToken);
      await refresh();
      router.push(data.redirectTo || "/me");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not accept the invitation. Ask your administrator to send a new one."
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <AuthLayout
        title="This invitation link is not valid"
        subtitle="The link is missing or incomplete."
        footer={
          <Link href="/login" className="font-medium text-brand-600 hover:underline">
            Go to sign in
          </Link>
        }
      >
        <Callout tone="warning">
          Invitations expire after seven days. Ask your administrator to send a fresh one.
        </Callout>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Set up your account"
      subtitle="Choose a password and you are in."
      points={[
        "See your attendance and leave balance",
        "Apply for leave and check where it is",
        "Download your payslips and documents",
        "Update your own contact details",
      ]}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Callout tone="danger">{error}</Callout>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="First name"
            autoFocus
            value={form.firstName}
            onChange={(event) => setForm({ ...form, firstName: event.target.value })}
            hint="Leave blank to keep what HR entered"
          />
          <Input
            label="Last name"
            value={form.lastName}
            onChange={(event) => setForm({ ...form, lastName: event.target.value })}
          />
        </div>

        <Input
          label="Choose a password"
          type={showPassword ? "text" : "password"}
          required
          autoComplete="new-password"
          value={form.password}
          onChange={(event) => setForm({ ...form, password: event.target.value })}
          hint="At least 10 characters, with an uppercase letter, a lowercase letter and a number."
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

        <Input
          label="Confirm password"
          type={showPassword ? "text" : "password"}
          required
          autoComplete="new-password"
          value={form.confirm}
          onChange={(event) => setForm({ ...form, confirm: event.target.value })}
          error={form.confirm && form.password !== form.confirm ? "These do not match" : undefined}
        />

        <Button type="submit" fullWidth size="lg" loading={submitting}>
          Accept invitation
        </Button>
      </form>
    </AuthLayout>
  );
}

export default function AcceptInvitationPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <AcceptForm />
    </Suspense>
  );
}
