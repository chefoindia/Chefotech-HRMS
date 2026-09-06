"use client";

import { useState } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { Button, Callout, Input } from "@/components/ui";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devResetUrl, setDevResetUrl] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      // The API reports success whether or not the address exists, so this
      // form cannot be used to discover who has an account. The one thing it
      // WILL say is that the server cannot send email at all — which is true
      // for every address alike, and worth knowing instead of waiting.
      const { data } = await api.post<{ message: string; devResetUrl?: string }>(
        "/auth/forgot-password",
        { email },
        { raw: true }
      );
      setDevResetUrl(data?.devResetUrl || null);
      setSent(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === "MAIL_ERROR") {
        setError(err.message);
      } else {
        // Anything else is treated as sent, for the enumeration reason above.
        setSent(true);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <AuthLayout
        title="Check your email"
        subtitle="If an account exists for that address, a reset link is on its way."
        footer={
          <Link href="/login" className="font-medium text-brand-600 hover:underline">
            Back to sign in
          </Link>
        }
      >
        <div className="rounded-[var(--radius)] border bg-[var(--surface-muted)] p-5 text-center">
          <span className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-brand-100 text-brand-700">
            <MailCheck className="h-5 w-5" aria-hidden />
          </span>
          <p className="text-[14px] text-[var(--text)]">
            We sent instructions to <strong>{email}</strong>.
          </p>
          <p className="mt-1.5 text-[13px] text-[var(--text-muted)]">
            The link expires in an hour. Check your spam folder if it has not arrived in a
            few minutes.
          </p>
        </div>

        {devResetUrl && (
          <Callout tone="warning" className="mt-4" title="Development only">
            Mail is switched off on this server, so here is the link that would have been
            emailed:{" "}
            <Link href={devResetUrl.replace(/^https?:\/\/[^/]+/, "")} className="break-all font-medium underline">
              open reset link
            </Link>
          </Callout>
        )}

        <Button variant="ghost" size="sm" className="mt-4" fullWidth onClick={() => setSent(false)}>
          Use a different address
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="Enter the email you sign in with and we will send you a link."
      footer={
        <Link href="/login" className="font-medium text-brand-600 hover:underline">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <Callout tone="danger">{error}</Callout>}

        <Input
          label="Work email"
          type="email"
          required
          autoFocus
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@company.com"
        />

        <Button type="submit" fullWidth size="lg" loading={submitting} disabled={!email.trim()}>
          Send reset link
        </Button>

        <Callout tone="info">
          Resetting your password signs you out of every device, which is what you want if
          you think someone else has your account.
        </Callout>
      </form>
    </AuthLayout>
  );
}
