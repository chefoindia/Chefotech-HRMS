"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, Menu, X } from "lucide-react";
import { CookieConsent, CookieSettingsLink } from "./CookieConsent";
import { Logo, PoweredBy } from "@/components/brand/Logo";
import { NAV_SECTIONS } from "@/content/marketing";
import { COMPANY } from "@/content/company";

/**
 * Marketing header and footer.
 *
 * The header carries a mega menu, which is the right pattern once a product
 * has more surface than fits in five words: a flat list forces every module to
 * compete for one of five slots, and the ones that lose become invisible.
 *
 * It opens on click as well as on hover. Hover-only menus are unusable with a
 * keyboard, unreachable on touch, and open by accident when the pointer
 * crosses them on the way somewhere else.
 */

const FLAT_LINKS = [
  { href: "/features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/security", label: "Security" },
];

export function MarketingHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);

  // Escape and click-outside. Both are what a person expects from a menu, and
  // neither happens for free.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenu(null);
        setMobileOpen(false);
      }
    };
    const onClick = (event: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(event.target as Node)) setOpenMenu(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, []);

  // A grace period on leaving: the gap between trigger and panel is a real
  // distance for an imprecise pointer, and closing instantly there makes the
  // menu feel broken.
  const scheduleClose = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpenMenu(null), 180);
  };
  const cancelClose = () => window.clearTimeout(closeTimer.current);

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--surface)]/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-5">
        <Link href="/" className="flex items-center" aria-label="Chefotech HRMS home">
          <Logo size="md" priority />
        </Link>

        <div ref={navRef} className="ml-2 hidden items-center gap-0.5 lg:flex">
          {NAV_SECTIONS.map((section) => {
            const isOpen = openMenu === section.label;
            return (
              <div
                key={section.label}
                className="relative"
                onMouseEnter={() => {
                  cancelClose();
                  setOpenMenu(section.label);
                }}
                onMouseLeave={scheduleClose}
              >
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-haspopup="true"
                  onClick={() => setOpenMenu(isOpen ? null : section.label)}
                  className="flex items-center gap-1 rounded-md px-3 py-2 text-[14px] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
                >
                  {section.label}
                  <ChevronDown
                    className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
                    aria-hidden
                  />
                </button>

                {isOpen && (
                  <div
                    onMouseEnter={cancelClose}
                    onMouseLeave={scheduleClose}
                    className="absolute left-0 top-full z-50 w-[620px] pt-2"
                  >
                    <div className="overflow-hidden rounded-xl border bg-[var(--surface)] shadow-[0_20px_50px_-12px_rgb(15_23_42_/_0.25)]">
                      <div className="grid grid-cols-2 gap-x-6 p-5">
                        {section.columns.map((column) => (
                          <div key={column.heading}>
                            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-subtle)]">
                              {column.heading}
                            </p>
                            <ul className="space-y-0.5">
                              {column.links.map((link) => (
                                <li key={link.href}>
                                  <Link
                                    href={link.href}
                                    onClick={() => setOpenMenu(null)}
                                    className="block rounded-lg px-2.5 py-2 transition-colors hover:bg-[var(--surface-muted)]"
                                  >
                                    <span className="block text-[13.5px] font-medium text-[var(--text)]">
                                      {link.label}
                                    </span>
                                    <span className="mt-0.5 block text-[12px] leading-snug text-[var(--text-muted)]">
                                      {link.description}
                                    </span>
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>

                      <div className="flex items-center justify-between gap-4 border-t bg-[var(--surface-muted)] px-5 py-3.5">
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium text-[var(--text)]">
                            {section.featured.title}
                          </p>
                          <p className="truncate text-[12px] text-[var(--text-muted)]">
                            {section.featured.body}
                          </p>
                        </div>
                        <Link
                          href={section.featured.href}
                          onClick={() => setOpenMenu(null)}
                          className="shrink-0 whitespace-nowrap rounded-lg border bg-[var(--surface)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-sunken)]"
                        >
                          {section.featured.cta}
                        </Link>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {FLAT_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-2 text-[14px] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="ml-auto hidden items-center gap-2 lg:flex">
          <Link
            href="/contact"
            className="inline-flex h-9 items-center rounded-lg px-3.5 text-[14px] font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
          >
            Talk to us
          </Link>
          <Link
            href="/login"
            className="inline-flex h-9 items-center rounded-lg border px-3.5 text-[14px] font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-muted)]"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="inline-flex h-9 items-center rounded-lg bg-brand-600 px-4 text-[14px] font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
          >
            Start free
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setMobileOpen((open) => !open)}
          className="ml-auto rounded-md p-2 text-[var(--text-muted)] hover:bg-[var(--surface-muted)] lg:hidden"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
        >
          {mobileOpen ? (
            <X className="h-5 w-5" aria-hidden />
          ) : (
            <Menu className="h-5 w-5" aria-hidden />
          )}
        </button>
      </div>

      {mobileOpen && (
        <div className="max-h-[calc(100vh-4rem)] overflow-y-auto border-t bg-[var(--surface)] px-5 py-4 lg:hidden">
          <nav className="space-y-5">
            {NAV_SECTIONS.map((section) => (
              <div key={section.label}>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-subtle)]">
                  {section.label}
                </p>
                <ul className="space-y-0.5">
                  {section.columns
                    .flatMap((column) => column.links)
                    .map((link) => (
                      <li key={link.href}>
                        <Link
                          href={link.href}
                          onClick={() => setMobileOpen(false)}
                          className="block rounded-md px-2.5 py-2 text-[14px] text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
                        >
                          {link.label}
                        </Link>
                      </li>
                    ))}
                </ul>
              </div>
            ))}

            <div className="border-t pt-4">
              {[...FLAT_LINKS, { href: "/support", label: "Support" }].map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className="block rounded-md px-2.5 py-2 text-[14px] text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
                >
                  {link.label}
                </Link>
              ))}
            </div>

            <div className="flex gap-2 border-t pt-4">
              <Link
                href="/login"
                onClick={() => setMobileOpen(false)}
                className="inline-flex h-10 flex-1 items-center justify-center rounded-lg border text-[14px] font-medium text-[var(--text)]"
              >
                Sign in
              </Link>
              <Link
                href="/register"
                onClick={() => setMobileOpen(false)}
                className="inline-flex h-10 flex-1 items-center justify-center rounded-lg bg-brand-600 text-[14px] font-medium text-white"
              >
                Start free
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}

const FOOTER_GROUPS = [
  {
    title: "Product",
    links: [
      ["Features", "/features"],
      ["Pricing", "/pricing"],
      ["Security", "/security"],
      ["Documentation", "/docs"],
    ],
  },
  {
    title: "Modules",
    links: [
      ["Core HR", "/docs/employee-records"],
      ["Attendance", "/docs/attendance-policy"],
      ["Leave", "/docs/leave-policy"],
      ["Payroll", "/docs/payroll-run"],
    ],
  },
  {
    title: "Support",
    links: [
      ["Help centre", "/support"],
      ["Contact us", "/contact"],
      ["System status", "/status"],
      ["Sign in", "/login"],
    ],
  },
  {
    title: "Company",
    links: [
      ["About Chefotech", "/about"],
      ["Privacy policy", "/legal/privacy"],
      ["Terms of service", "/legal/terms"],
      ["All legal documents", "/legal"],
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer className="border-t bg-[var(--surface)]">
      <div className="mx-auto max-w-7xl px-5 py-14">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div>
            <Logo size="md" />
            <p className="mt-3 max-w-xs text-[13px] leading-relaxed text-[var(--text-muted)]">
              HR, attendance, leave and payroll for organisations that need their own rules
              rather than someone else&apos;s.
            </p>
            <a
              href={`mailto:${COMPANY.email.sales}`}
              className="mt-3 inline-block text-[13px] font-medium text-brand-700 hover:underline"
            >
              {COMPANY.email.sales}
            </a>
          </div>

          {FOOTER_GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="text-[13px] font-semibold text-[var(--text)]">{group.title}</h3>
              <ul className="mt-3 space-y-2">
                {group.links.map(([label, href]) => (
                  <li key={label}>
                    <Link
                      href={href}
                      className="text-[13px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12.5px] text-[var(--text-subtle)]">
            © {new Date().getFullYear()} {COMPANY.legalName}. All rights reserved.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <CookieSettingsLink />
            <Link
              href="/legal/terms"
              className="text-[12.5px] text-[var(--text-subtle)] transition-colors hover:text-[var(--text-muted)]"
            >
              Terms
            </Link>
            <Link
              href="/legal/privacy"
              className="text-[12.5px] text-[var(--text-subtle)] transition-colors hover:text-[var(--text-muted)]"
            >
              Privacy
            </Link>
            <PoweredBy className="text-[12.5px] text-[var(--text-subtle)]" />
          </div>
        </div>
      </div>

      <CookieConsent />
    </footer>
  );
}
