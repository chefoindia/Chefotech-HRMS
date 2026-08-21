"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * Cookie consent.
 *
 * Consent regimes that require a banner at all also require that refusing is
 * as easy as accepting — a prominent "Accept all" beside a buried "manage
 * preferences" is the pattern regulators have specifically ruled against. So
 * both choices are real buttons of equal weight, and nothing optional is
 * loaded until an explicit accept.
 *
 * The choice is stored locally rather than in a cookie set before consent,
 * which would be the same mistake the banner exists to avoid.
 */

const STORAGE_KEY = "chefotech.cookie-consent";

export type ConsentValue = "accepted" | "rejected";

export function readConsent(): ConsentValue | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "accepted" || stored === "rejected" ? stored : null;
}

/** Lets the footer link reopen the banner after a decision. */
export function reopenCookieSettings() {
  window.localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent("chefotech:cookie-settings"));
}

export function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!readConsent()) setVisible(true);
    const reopen = () => setVisible(true);
    window.addEventListener("chefotech:cookie-settings", reopen);
    return () => window.removeEventListener("chefotech:cookie-settings", reopen);
  }, []);

  function decide(value: ConsentValue) {
    window.localStorage.setItem(STORAGE_KEY, value);
    setVisible(false);
    // Analytics initialisation listens for this. Nothing optional runs before it.
    window.dispatchEvent(new CustomEvent("chefotech:consent", { detail: value }));
  }

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Cookie preferences"
      className="fixed inset-x-0 bottom-0 z-[150] border-t bg-[var(--surface)] p-4 shadow-lg sm:p-5"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-4 sm:flex-row sm:items-center">
        <p className="flex-1 text-[13.5px] leading-relaxed text-[var(--text-muted)]">
          We use cookies that are strictly necessary to sign you in and keep the product secure.
          With your permission we would also record anonymous usage of this site so we can tell
          which pages are useful. We do not use advertising cookies.{" "}
          <Link href="/legal/cookies" className="underline underline-offset-2 hover:text-[var(--text)]">
            Read the cookie policy
          </Link>
          .
        </p>

        {/* Equal weight, deliberately. */}
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => decide("rejected")}
            className="h-9 rounded-[calc(var(--radius)-2px)] border bg-[var(--surface)] px-4 text-[13.5px] font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-muted)]"
          >
            Necessary only
          </button>
          <button
            type="button"
            onClick={() => decide("accepted")}
            className="h-9 rounded-[calc(var(--radius)-2px)] bg-brand-600 px-4 text-[13.5px] font-medium text-white transition-colors hover:bg-brand-700"
          >
            Accept all
          </button>
        </div>
      </div>
    </div>
  );
}

/** The footer control that lets someone change their mind. */
export function CookieSettingsLink() {
  return (
    <button
      type="button"
      onClick={reopenCookieSettings}
      className="text-[12.5px] text-[var(--text-subtle)] underline underline-offset-2 transition-colors hover:text-[var(--text-muted)]"
    >
      Cookie settings
    </button>
  );
}
