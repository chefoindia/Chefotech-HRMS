"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Download,
  Minus,
  Plus,
  Rocket,
  ShieldCheck,
  Smartphone,
  Sparkles,
} from "lucide-react";
import {
  AI_HIGHLIGHTS,
  APP_PLATFORMS,
  CAPABILITY_STRIP,
  FEATURE_MODULES,
  HOME_FAQS,
  INTEGRATIONS,
  TESTIMONIALS,
  TRUST_METRICS,
} from "@/content/marketing";
import { MOCKUPS } from "./Mockups";

/**
 * The home page sections.
 *
 * Two of these — testimonials and trust metrics — render nothing at all while
 * their content arrays are empty. That is deliberate: an empty section is
 * better than an invented customer quote, and a site that quietly grows those
 * sections when real ones exist is better than one that ships with filler
 * somebody forgets to replace.
 */

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b bg-[var(--surface)]">
      {/* A soft brand wash rather than a flat block: keeps the hero distinct
          from the sections below without a hard colour boundary. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60rem 30rem at 15% -10%, var(--brand-50), transparent 60%), radial-gradient(40rem 24rem at 95% 0%, color-mix(in oklab, var(--accent) 12%, transparent), transparent 65%)",
        }}
      />

      <div className="relative mx-auto max-w-7xl px-5 py-16 lg:py-24">
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-[12.5px] font-medium text-brand-700">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              Every calculation explains itself
            </span>

            <h1 className="mt-5 text-[36px] font-semibold leading-[1.1] tracking-tight text-[var(--text)] sm:text-[44px] lg:text-[52px]">
              HR software that runs{" "}
              <span className="text-brand-600">your rules</span>, not someone else&apos;s
            </h1>

            <p className="mt-5 max-w-xl text-[16.5px] leading-relaxed text-[var(--text-muted)]">
              Employees, attendance, leave and payroll in one platform — where grace periods,
              half-day thresholds, accrual rates and salary formulas are settings you control
              rather than assumptions you inherit.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link
                href="/register"
                className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-brand-600 px-6 text-[15px] font-medium text-white shadow-sm transition-colors hover:bg-brand-700"
              >
                Start free
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <Link
                href="/contact"
                className="inline-flex h-11 items-center rounded-lg border bg-[var(--surface)] px-6 text-[15px] font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-muted)]"
              >
                Request a demo
              </Link>
            </div>

            <p className="mt-4 text-[13px] text-[var(--text-subtle)]">
              Full account, not a sandbox · No card required · Export your data any time
            </p>
          </div>

          <div className="lg:pl-4">
            {/* The product, not a stock photograph of people at a desk. */}
            <MOCKUPS.dashboard />
          </div>
        </div>

        <ul className="mt-14 flex flex-wrap items-center justify-center gap-x-7 gap-y-3 border-t pt-8">
          {CAPABILITY_STRIP.map((item) => (
            <li
              key={item}
              className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--text-muted)]"
            >
              <Check className="h-3.5 w-3.5 text-brand-600" aria-hidden />
              {item}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function FeatureModules() {
  return (
    <section className="border-b bg-[var(--surface)]">
      <div className="mx-auto max-w-7xl px-5 py-16 lg:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-[12.5px] font-semibold uppercase tracking-wider text-brand-600">
            The platform
          </p>
          <h2 className="mt-2 text-[28px] font-semibold tracking-tight text-[var(--text)] lg:text-[34px]">
            Four modules, one set of rules
          </h2>
          <p className="mt-3 text-[15.5px] leading-relaxed text-[var(--text-muted)]">
            They share the same policy engine, so a change to your working week reaches
            attendance, leave and payroll at once — instead of three places you have to
            remember.
          </p>
        </div>

        <div className="mt-14 space-y-16 lg:space-y-24">
          {FEATURE_MODULES.map((module) => {
            const Visual = MOCKUPS[module.visual];
            return (
              <div
                key={module.id}
                id={module.id}
                className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16"
              >
                <div className={module.flip ? "lg:order-2" : undefined}>
                  <p className="text-[12.5px] font-semibold uppercase tracking-wider text-brand-600">
                    {module.eyebrow}
                  </p>
                  <h3 className="mt-2 text-[24px] font-semibold leading-tight tracking-tight text-[var(--text)] lg:text-[28px]">
                    {module.title}
                  </h3>
                  <p className="mt-3 text-[15px] leading-relaxed text-[var(--text-muted)]">
                    {module.body}
                  </p>

                  <ul className="mt-5 space-y-2.5">
                    {module.points.map((point) => (
                      <li key={point} className="flex items-start gap-2.5">
                        <span
                          className="mt-[3px] grid h-4 w-4 shrink-0 place-items-center rounded-full bg-brand-50"
                          aria-hidden
                        >
                          <Check className="h-2.5 w-2.5 text-brand-600" />
                        </span>
                        <span className="text-[14.5px] leading-relaxed text-[var(--text-muted)]">
                          {point}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <Link
                    href={module.href}
                    className="group mt-6 inline-flex items-center gap-1.5 text-[14.5px] font-medium text-brand-700 hover:underline"
                  >
                    How this works
                    <ArrowRight
                      className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </Link>
                </div>

                <div className={module.flip ? "lg:order-1" : undefined}>
                  <Visual />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function SecurityBand() {
  const points = [
    {
      title: "Tenant isolation at the data layer",
      body: "A query without an authenticated tenant context fails rather than returning data. Isolation is architecture here, not developer diligence.",
    },
    {
      title: "Append-only audit trail",
      body: "Sign-ins, permission changes, salary edits and exports are recorded with actor, time and before/after — and cannot be edited, including by an owner.",
    },
    {
      title: "Least-privilege by default",
      body: "Salary visibility is a separate permission from the rest of a record, so a manager can approve leave without seeing pay.",
    },
  ];

  return (
    <section className="border-b bg-[var(--surface-muted)]">
      <div className="mx-auto max-w-7xl px-5 py-16 lg:py-20">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-[12.5px] font-medium text-[var(--text-muted)]">
              <ShieldCheck className="h-3.5 w-3.5 text-brand-600" aria-hidden />
              Security
            </span>
            <h2 className="mt-4 text-[28px] font-semibold tracking-tight text-[var(--text)] lg:text-[32px]">
              An HRMS holds the most sensitive data you have
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-[var(--text-muted)]">
              Salaries, addresses, attendance patterns, medical leave. These are the controls
              that protect it — described plainly enough that your security reviewer can check
              them.
            </p>
            <Link
              href="/security"
              className="group mt-5 inline-flex items-center gap-1.5 text-[14.5px] font-medium text-brand-700 hover:underline"
            >
              Read the security page
              <ArrowRight
                className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
          </div>

          <div className="space-y-3">
            {points.map((point) => (
              <div key={point.title} className="rounded-xl border bg-[var(--surface)] p-5">
                <h3 className="text-[15px] font-semibold text-[var(--text)]">{point.title}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--text-muted)]">
                  {point.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function IntegrationsSection() {
  const byCategory = INTEGRATIONS.reduce<Record<string, typeof INTEGRATIONS>>((acc, item) => {
    (acc[item.category] ||= []).push(item);
    return acc;
  }, {});

  return (
    <section className="border-b bg-[var(--surface)]">
      <div className="mx-auto max-w-7xl px-5 py-16 lg:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-[12.5px] font-semibold uppercase tracking-wider text-brand-600">
            Connects to
          </p>
          <h2 className="mt-2 text-[28px] font-semibold tracking-tight text-[var(--text)] lg:text-[32px]">
            What it talks to today
          </h2>
          <p className="mt-3 text-[15.5px] leading-relaxed text-[var(--text-muted)]">
            Only integrations that actually work. A logo you discover is aspirational during
            implementation is worse than one that was never claimed.
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(byCategory).map(([category, items]) => (
            <div key={category} className="rounded-xl border bg-[var(--surface-muted)] p-5">
              <h3 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--text-subtle)]">
                {category}
              </h3>
              <ul className="mt-3 space-y-2">
                {items.map((item) => (
                  <li key={item.name} className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 shrink-0 text-brand-600" aria-hidden />
                    <span className="text-[13.5px] text-[var(--text)]">{item.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <p className="mt-6 text-center text-[13.5px] text-[var(--text-muted)]">
          Need something else?{" "}
          <Link href="/contact" className="font-medium text-brand-700 hover:underline">
            Tell us what you use
          </Link>
          .
        </p>
      </div>
    </section>
  );
}

/** Renders nothing until there are real, permissioned customer quotes. */
export function TestimonialsSection() {
  const [index, setIndex] = useState(0);
  if (TESTIMONIALS.length === 0) return null;

  const current = TESTIMONIALS[index];
  return (
    <section className="border-b bg-[var(--surface-muted)]">
      <div className="mx-auto max-w-3xl px-5 py-16 text-center lg:py-20">
        <blockquote className="text-[20px] font-medium leading-relaxed text-[var(--text)]">
          &ldquo;{current.quote}&rdquo;
        </blockquote>
        <p className="mt-5 text-[14px] text-[var(--text-muted)]">
          <span className="font-semibold text-[var(--text)]">{current.name}</span> · {current.role},{" "}
          {current.company}
        </p>

        {TESTIMONIALS.length > 1 && (
          <div className="mt-6 flex items-center justify-center gap-2">
            {TESTIMONIALS.map((testimonial, position) => (
              <button
                key={testimonial.name}
                type="button"
                onClick={() => setIndex(position)}
                aria-label={`Show testimonial ${position + 1}`}
                aria-current={position === index}
                className={
                  position === index
                    ? "h-2 w-6 rounded-full bg-brand-600"
                    : "h-2 w-2 rounded-full bg-[var(--border-strong)] transition-colors hover:bg-[var(--text-subtle)]"
                }
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** Renders nothing until there are real, verifiable numbers. */
export function MetricsBand() {
  if (TRUST_METRICS.length === 0) return null;
  return (
    <section className="border-b bg-[var(--surface)]">
      <div className="mx-auto grid max-w-5xl gap-8 px-5 py-14 text-center sm:grid-cols-3">
        {TRUST_METRICS.map((metric) => (
          <div key={metric.label}>
            <p className="text-[32px] font-semibold tracking-tight text-brand-600">
              {metric.value}
            </p>
            <p className="mt-1 text-[14px] font-medium text-[var(--text)]">{metric.label}</p>
            {metric.note && (
              <p className="mt-0.5 text-[12.5px] text-[var(--text-subtle)]">{metric.note}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * The AI setup assistant, highlighted on its own.
 *
 * Every claim here maps to a shipped endpoint — `POST /help/ask` falling back
 * to Gemini, and `POST /ai/draft/leave-policy` — not a roadmap item, which is
 * why this is safe to put in front of a buyer before they have signed up.
 */
export function AiHighlightSection() {
  return (
    <section className="border-b bg-[var(--surface)]">
      <div className="mx-auto max-w-7xl px-5 py-16 lg:py-20">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-[12.5px] font-medium text-brand-700">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              AI-assisted setup
            </span>
            <h2 className="mt-4 text-[28px] font-semibold tracking-tight text-[var(--text)] lg:text-[32px]">
              Setup has a lot of screens. You are never stuck on one alone.
            </h2>
            <p className="mt-3 text-[15px] leading-relaxed text-[var(--text-muted)]">
              An HRMS has dozens of settings across attendance, leave and payroll, and it is easy
              to freeze on a field wondering what it actually controls. The assistant answers
              that in seconds, grounded in this product — and where it can, drafts the
              configuration itself for you to review.
            </p>
            <Link
              href="/app/settings/ai"
              className="group mt-5 inline-flex items-center gap-1.5 text-[14.5px] font-medium text-brand-700 hover:underline"
            >
              Set up your own AI key
              <ArrowRight
                className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
          </div>

          <div className="space-y-3">
            {AI_HIGHLIGHTS.map((item) => (
              <div key={item.title} className="rounded-xl border bg-[var(--surface-muted)] p-5">
                <h3 className="text-[15px] font-semibold text-[var(--text)]">{item.title}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--text-muted)]">
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/** The employee-app promotion band — Android and web live today. */
export function MobileAppBand() {
  const live = APP_PLATFORMS.filter((p) => p.status === "live");

  return (
    <section className="border-b bg-[var(--surface-muted)]">
      <div className="mx-auto max-w-5xl px-5 py-16 text-center lg:py-20">
        <span className="inline-flex items-center gap-1.5 rounded-full border bg-[var(--surface)] px-3 py-1 text-[12.5px] font-medium text-[var(--text-muted)]">
          <Smartphone className="h-3.5 w-3.5 text-brand-600" aria-hidden />
          Employee app
        </span>
        <h2 className="mx-auto mt-4 max-w-2xl text-[28px] font-semibold tracking-tight text-[var(--text)] lg:text-[32px]">
          Check in, apply for leave, read a payslip — from a phone
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-[var(--text-muted)]">
          A native Android app and a web app that works on any device, themed automatically with
          your own brand colour the moment you set one.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {live.map((platform) => (
            <Link
              key={platform.id}
              href={platform.href}
              {...(platform.id === "android" ? { download: true } : {})}
              className="inline-flex h-11 items-center gap-2 rounded-lg border bg-[var(--surface)] px-5 text-[14.5px] font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-sunken)]"
            >
              {platform.id === "android" ? (
                <Download className="h-4 w-4 text-brand-600" aria-hidden />
              ) : (
                <Rocket className="h-4 w-4 text-brand-600" aria-hidden />
              )}
              {platform.cta}
            </Link>
          ))}
          <Link
            href="/download"
            className="inline-flex h-11 items-center gap-1.5 px-2 text-[14.5px] font-medium text-brand-700 hover:underline"
          >
            See everything it does
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  );
}

export function FaqAccordion() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section className="border-b bg-[var(--surface)]">
      <div className="mx-auto max-w-3xl px-5 py-16 lg:py-20">
        <div className="text-center">
          <h2 className="text-[28px] font-semibold tracking-tight text-[var(--text)] lg:text-[32px]">
            Questions worth asking before you buy
          </h2>
          <p className="mt-3 text-[15.5px] text-[var(--text-muted)]">
            The ones that decide whether a system actually fits how you work.
          </p>
        </div>

        <div className="mt-10 divide-y rounded-xl border">
          {HOME_FAQS.map((faq, index) => {
            const isOpen = open === index;
            return (
              <div key={faq.q}>
                <h3>
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : index)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-[var(--surface-muted)]"
                  >
                    <span className="text-[15px] font-medium text-[var(--text)]">{faq.q}</span>
                    {isOpen ? (
                      <Minus className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                    ) : (
                      <Plus className="h-4 w-4 shrink-0 text-[var(--text-subtle)]" aria-hidden />
                    )}
                  </button>
                </h3>
                {isOpen && (
                  <div className="px-5 pb-5">
                    <p className="text-[14.5px] leading-relaxed text-[var(--text-muted)]">
                      {faq.a}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <p className="mt-6 text-center text-[14px] text-[var(--text-muted)]">
          More in the{" "}
          <Link href="/support" className="font-medium text-brand-700 hover:underline">
            help centre
          </Link>{" "}
          and the{" "}
          <Link href="/docs" className="font-medium text-brand-700 hover:underline">
            documentation
          </Link>
          .
        </p>
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section className="bg-[var(--surface)]">
      <div className="mx-auto max-w-7xl px-5 py-16 lg:py-20">
        <div
          className="relative overflow-hidden rounded-2xl px-6 py-14 text-center"
          style={{
            background:
              "linear-gradient(135deg, var(--brand-700), var(--brand-600) 55%, color-mix(in oklab, var(--accent) 65%, var(--brand-600)))",
          }}
        >
          <h2 className="text-[28px] font-semibold tracking-tight text-white lg:text-[34px]">
            Try it with your own policies
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-[15.5px] leading-relaxed text-white/85">
            Configure your real leave rules, your real shifts, your real salary structure — and
            see what the engine does with them before you decide.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/register"
              className="inline-flex h-11 items-center rounded-lg bg-white px-6 text-[15px] font-medium text-brand-700 shadow-sm transition-colors hover:bg-white/90"
            >
              Start free
            </Link>
            <Link
              href="/contact"
              className="inline-flex h-11 items-center rounded-lg border border-white/35 px-6 text-[15px] font-medium text-white transition-colors hover:bg-white/10"
            >
              Request a demo
            </Link>
          </div>
          <p className="mt-4 text-[13px] text-white/70">
            No card required · Export your data any time · Cancel from Settings
          </p>
        </div>
      </div>
    </section>
  );
}
