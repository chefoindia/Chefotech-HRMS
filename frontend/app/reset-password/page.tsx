"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { Button, Callout, Input, PageLoader } from "@/components/ui";

function ResetForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      await api.post("/auth/reset-password", { token, password }, { raw: true });
      router.push("/login?reset=1");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not reset your password. Please request a new link."
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return (
      <AuthLayout
        title="This link is not valid"
        subtitle="The reset link is missing or incomplete."
        footer={
          <Link href="/forgot-password" className="font-medium text-brand-600 hover:underline">
            Request a new link
          </Link>
        }
      >
        <Callout tone="warning">
          Reset links expire after an hour and can only be used once. Request a fresh one to
          continue.
        </Callout>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Choose a new password" subtitle="Make it something you have not used here before.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Callout tone="danger">{error}</Callout>}

        <Input
          label="New password"
          type={showPassword ? "text" : "password"}
          required
          autoFocus
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
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
          label="Confirm new password"
          type={showPassword ? "text" : "password"}
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          error={confirm && password !== confirm ? "These do not match" : undefined}
        />

        <Button type="submit" fullWidth size="lg" loading={submitting}>
          Change password
        </Button>
      </form>
    </AuthLayout>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <ResetForm />
    </Suspense>
  );
}
