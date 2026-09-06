"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { MailWarning, X } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button, useToast } from "@/components/ui";

const DISMISS_KEY = "chefotech.verify_banner_dismissed";

/**
 * "Confirm your email" — shown until the address is verified.
 *
 * Verification gates nothing, so the banner is the only prompt. It can be
 * dismissed for the session (a nag that cannot be closed gets ad-blocked in
 * the mind), and offers the resend in place because the original email is
 * usually the one that went to spam.
 */
export function EmailVerificationBanner() {
  const { session, refresh } = useSession();
  const toast = useToast();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  const resend = useMutation({
    mutationFn: async () => (await api.post<{ ok: boolean; alreadyVerified?: boolean; sentTo?: string }>("/auth/resend-verification")).data,
    onSuccess: async (result) => {
      if (result.alreadyVerified) {
        toast.success("Already confirmed");
        await refresh();
      } else {
        toast.success("Confirmation email sent", `Check ${result.sentTo} — including spam.`);
      }
    },
    onError: (error) => toast.fromError(error, "Could not send the confirmation email."),
  });

  if (!session || session.user.emailVerified || dismissed) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-amber-200 bg-[var(--warning-bg)] px-4 py-2.5 text-[13px]">
      <MailWarning className="h-4 w-4 shrink-0 text-[var(--warning)]" aria-hidden />
      <p className="min-w-0 flex-1 text-[var(--text)]">
        Confirm your email address <strong>{session.user.email}</strong> so password resets and notifications reach you.
      </p>
      <Button size="sm" variant="outline" loading={resend.isPending} onClick={() => resend.mutate()}>
        Resend confirmation
      </Button>
      <button
        type="button"
        onClick={() => {
          try {
            sessionStorage.setItem(DISMISS_KEY, "1");
          } catch {
            /* private mode */
          }
          setDismissed(true);
        }}
        className="rounded p-1 text-[var(--text-muted)] hover:bg-black/5"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
