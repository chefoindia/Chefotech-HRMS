"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, MailWarning } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { Button, Callout, PageLoader } from "@/components/ui";

/**
 * The page the welcome email links to.
 *
 * It did not exist: the email said "confirm your address here" and the link
 * landed on the 404 page, which is a poor first minute with a new product.
 */
function VerifyEmail() {
  const params = useSearchParams();
  const { session, refresh } = useSession();
  const token = params.get("token");

  const [state, setState] = useState<"working" | "done" | "failed">("working");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    if (!token) {
      setState("failed");
      setMessage("This link is missing its confirmation code. Open the link from the email again, or ask for a new one.");
      return;
    }
    api
      .post("/auth/verify-email", { token }, { raw: true })
      .then(async () => {
        setState("done");
        await refresh().catch(() => undefined);
      })
      .catch((err) => {
        setState("failed");
        setMessage(err instanceof ApiError ? err.message : "Could not confirm your email address.");
      });
  }, [token, refresh]);

  if (state === "working") return <PageLoader label="Confirming your email" />;

  const next = session ? (session.organization ? "/app" : "/login") : "/login";

  return (
    <AuthLayout
      title={state === "done" ? "Email confirmed" : "That link did not work"}
      subtitle={state === "done" ? "Thanks — your address is verified." : undefined}
      footer={
        <Link href="/login" className="font-medium text-brand-600 hover:underline">
          Back to sign in
        </Link>
      }
    >
      {state === "done" ? (
        <div className="space-y-4">
          <div className="rounded-[var(--radius)] border bg-[var(--surface-muted)] p-5 text-center">
            <span className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-[var(--success-bg)] text-[var(--success)]">
              <CheckCircle2 className="h-5 w-5" aria-hidden />
            </span>
            <p className="text-[14px] text-[var(--text)]">Password resets and notifications will reach this address.</p>
          </div>
          <Link href={next} className="block">
            <Button fullWidth size="lg">
              {session ? "Continue" : "Sign in"}
            </Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          <Callout tone="danger" icon={<MailWarning className="h-4 w-4" />}>
            {message}
          </Callout>
          <p className="text-[13px] text-[var(--text-muted)]">
            Links expire after 48 hours. Sign in and use <strong>Resend confirmation</strong> from the banner at the top of the app to get a fresh one.
          </p>
        </div>
      )}
    </AuthLayout>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <VerifyEmail />
    </Suspense>
  );
}
