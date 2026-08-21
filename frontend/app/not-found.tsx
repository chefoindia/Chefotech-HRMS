import Link from "next/link";
import { PoweredBy } from "@/components/brand/Logo";

/**
 * The 404 page.
 *
 * Next's built-in 404 is unstyled and unbranded — on a product a customer is
 * paying for, landing on it reads as "this app is broken" rather than "that
 * address does not exist". This one keeps the person inside the product and
 * offers the two things that actually resolve a wrong URL: go back, or go
 * somewhere real.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--surface-sunken,#f8fafc)] px-6 py-16">
      <div className="w-full max-w-md text-center">
        <p className="text-[13px] font-medium uppercase tracking-wider text-[var(--text-muted,#64748b)]">
          Error 404
        </p>

        <h1 className="mt-3 text-2xl font-semibold text-[var(--text,#0f172a)]">
          We could not find that page
        </h1>

        <p className="mt-3 text-[14px] leading-relaxed text-[var(--text-muted,#64748b)]">
          The address may have been mistyped, or the page may have moved. Nothing has gone wrong
          with your data.
        </p>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/app"
            className="rounded-lg bg-brand-600 px-4 py-2 text-[13.5px] font-medium text-white transition hover:bg-brand-700"
          >
            Go to dashboard
          </Link>
          <Link
            href="/me"
            className="rounded-lg border border-[var(--border,#e2e8f0)] bg-[var(--surface,#fff)] px-4 py-2 text-[13.5px] font-medium text-[var(--text,#0f172a)] transition hover:bg-[var(--surface-hover,#f1f5f9)]"
          >
            My portal
          </Link>
        </div>

        <PoweredBy className="mt-10 text-[12px] text-[var(--text-subtle,#94a3b8)]" />
      </div>
    </main>
  );
}
