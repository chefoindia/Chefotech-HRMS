import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { MarketingPage, Section } from "@/components/marketing/Page";
import { DOC_CATEGORIES, articlesInCategory } from "@/content/docs";

export const metadata: Metadata = {
  title: "Features",
  description:
    "Employee records, attendance, leave, payroll, biometric devices, approvals, documents and reporting — with the rules under your control.",
  alternates: { canonical: "/features" },
};

/**
 * The feature list is derived from the documentation rather than written
 * separately. A marketing page that claims a capability the docs do not cover
 * is how a sales promise becomes a support ticket.
 */

const DEPTH = [
  {
    title: "The rules are yours",
    body: "Grace periods, half-day thresholds, accrual rates, carry-forward caps and salary formulas are configuration. Changing how your organisation treats a late arrival is a setting, not a support request and not a release.",
  },
  {
    title: "Every number can be explained",
    body: "Attendance days, leave costs and payslip lines each carry the working behind them — which rule fired, on which input, producing which result. When someone disputes a figure, the answer is on screen.",
  },
  {
    title: "Isolation you can describe to an auditor",
    body: "Each tenant's data is separated at the data-access layer, not by a filter that a developer has to remember to add. A query without an authenticated tenant context fails rather than returning everything.",
  },
  {
    title: "Nothing is silently discarded",
    body: "Raw biometric events are kept alongside the attendance computed from them, so a mis-configured device can be remapped and reprocessed. Audit entries are append-only. Terminated employees keep their history.",
  },
];

export default function FeaturesPage() {
  return (
    <MarketingPage
      eyebrow="Features"
      title="What the platform does"
      intro="A complete HR system for organisations that need their own rules rather than someone else's defaults. Every item below links to the documentation for it, so you can check the detail before you commit."
    >
      {DOC_CATEGORIES.map((category) => {
        const articles = articlesInCategory(category.id);
        if (!articles.length) return null;
        return (
          <Section key={category.id} title={category.title} description={category.description}>
            <ul className="space-y-2">
              {articles.map((article) => (
                <li key={article.slug}>
                  <Link
                    href={`/docs/${article.slug}`}
                    className="group flex items-start gap-3 rounded-lg border bg-[var(--surface)] p-4 transition-colors hover:border-brand-300 hover:bg-[var(--surface-muted)]"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[14.5px] font-semibold text-[var(--text)]">
                        {article.title}
                      </p>
                      <p className="mt-1 text-[13.5px] leading-relaxed text-[var(--text-muted)]">
                        {article.summary}
                      </p>
                    </div>
                    <ArrowRight
                      className="mt-1 h-4 w-4 shrink-0 text-[var(--text-subtle)] transition-transform group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        );
      })}

      <Section
        title="What makes it different"
        description="Four decisions that shape everything above."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {DEPTH.map((item) => (
            <div key={item.title} className="rounded-xl border bg-[var(--surface)] p-5">
              <h3 className="text-[15px] font-semibold text-[var(--text)]">{item.title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--text-muted)]">
                {item.body}
              </p>
            </div>
          ))}
        </div>
      </Section>
    </MarketingPage>
  );
}
