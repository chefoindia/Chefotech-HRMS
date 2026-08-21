import type { ReactNode } from "react";
import Link from "next/link";
import { MarketingHeader, MarketingFooter } from "./Chrome";

/**
 * Shared furniture for the public pages.
 *
 * Every marketing page has the same skeleton — header, a hero that states what
 * the page is, sections, footer. Putting that here means a new page is content
 * plus a title, and it cannot accidentally ship with different spacing or a
 * missing skip target.
 */

export function MarketingPage({
  eyebrow,
  title,
  intro,
  children,
  cta = true,
}: {
  eyebrow?: string;
  title: string;
  intro?: string;
  children: ReactNode;
  cta?: boolean;
}) {
  return (
    <>
      <MarketingHeader />
      <main id="main">
        <header className="border-b bg-[var(--surface-muted)]">
          <div className="mx-auto max-w-4xl px-5 py-14 lg:py-20">
            {eyebrow && (
              <p className="text-[12.5px] font-semibold uppercase tracking-wider text-brand-600">
                {eyebrow}
              </p>
            )}
            <h1 className="mt-2 text-[32px] font-semibold leading-tight tracking-tight text-[var(--text)] lg:text-[38px]">
              {title}
            </h1>
            {intro && (
              <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-[var(--text-muted)]">
                {intro}
              </p>
            )}
          </div>
        </header>

        <div className="mx-auto max-w-4xl px-5 py-12 lg:py-16">{children}</div>

        {cta && <ClosingCta />}
      </main>
      <MarketingFooter />
    </>
  );
}

export function Section({
  title,
  description,
  children,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-12 last:mb-0">
      {title && (
        <h2 className="text-[20px] font-semibold tracking-tight text-[var(--text)]">{title}</h2>
      )}
      {description && (
        <p className="mt-2 max-w-2xl text-[14.5px] leading-relaxed text-[var(--text-muted)]">
          {description}
        </p>
      )}
      <div className={title || description ? "mt-5" : ""}>{children}</div>
    </section>
  );
}

/** Body copy with readable measure and rhythm. */
export function Prose({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-3 text-[14.5px] leading-relaxed text-[var(--text-muted)]">
      {children}
    </div>
  );
}

export function Card({
  title,
  children,
  icon,
}: {
  title: string;
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-[var(--surface)] p-5">
      {icon && <div className="mb-3 text-brand-600">{icon}</div>}
      <h3 className="text-[15px] font-semibold text-[var(--text)]">{title}</h3>
      <div className="mt-2 text-[13.5px] leading-relaxed text-[var(--text-muted)]">{children}</div>
    </div>
  );
}

export function ClosingCta() {
  return (
    <section className="border-t bg-[var(--surface-muted)]">
      <div className="mx-auto max-w-4xl px-5 py-14 text-center">
        <h2 className="text-[22px] font-semibold tracking-tight text-[var(--text)]">
          Try it with your own policies
        </h2>
        <p className="mx-auto mt-2 max-w-lg text-[14.5px] leading-relaxed text-[var(--text-muted)]">
          The trial is a full account, not a sandbox. Configure your real leave rules and see
          what the engine does with them.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/register"
            className="inline-flex h-10 items-center rounded-[calc(var(--radius)-2px)] bg-brand-600 px-5 text-[14px] font-medium text-white transition-colors hover:bg-brand-700"
          >
            Start free
          </Link>
          <Link
            href="/contact"
            className="inline-flex h-10 items-center rounded-[calc(var(--radius)-2px)] border bg-[var(--surface)] px-5 text-[14px] font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-muted)]"
          >
            Talk to us
          </Link>
        </div>
      </div>
    </section>
  );
}
