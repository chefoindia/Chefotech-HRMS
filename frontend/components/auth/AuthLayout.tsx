"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { CheckCircle2 } from "lucide-react";

/**
 * The shell for every unauthenticated page.
 *
 * Two panes on a large screen: the form on the left, a quiet marketing panel
 * on the right. On a phone the panel disappears entirely — someone signing in
 * from the factory floor at 6am does not need the pitch.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
  points,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  points?: string[];
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col justify-center px-5 py-10 sm:px-10 lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          <Link href="/" className="mb-8 inline-flex items-center" aria-label="Chefotech HRMS home">
            <Logo size="lg" priority />
          </Link>

          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)]">{title}</h1>
          {subtitle && <p className="mt-1.5 text-[14px] text-[var(--text-muted)]">{subtitle}</p>}

          <div className="mt-7">{children}</div>

          {footer && <div className="mt-6 text-[13.5px] text-[var(--text-muted)]">{footer}</div>}
        </div>
      </div>

      <div className="relative hidden overflow-hidden bg-[var(--sidebar-bg)] lg:block">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              "radial-gradient(40rem 24rem at 70% 20%, var(--brand-700), transparent 60%), radial-gradient(30rem 20rem at 20% 80%, #0e7490, transparent 60%)",
          }}
          aria-hidden
        />

        <div className="relative flex h-full flex-col justify-center px-14">
          <blockquote className="max-w-md">
            <p className="text-[22px] font-medium leading-snug text-white">
              Your policies, your branding, your approval chains — without a custom build.
            </p>
            <footer className="mt-4 text-[14px] text-white/60">Chefotech HRMS</footer>
          </blockquote>

          <ul className="mt-10 space-y-3">
            {(
              points || [
                "Attendance rules you configure, including night shifts and half days",
                "Leave accruals, carry forward and the sandwich rule",
                "Payroll formulas you control, with every figure explainable",
                "Guided help that performs the task with you",
              ]
            ).map((point) => (
              <li key={point} className="flex gap-2.5">
                <CheckCircle2 className="mt-0.5 h-4.5 w-4.5 shrink-0 text-white/50" aria-hidden />
                <span className="text-[14px] text-white/75">{point}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
