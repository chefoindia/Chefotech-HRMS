import type { Metadata } from "next";
import { MarketingHeader, MarketingFooter } from "@/components/marketing/Chrome";
import {
  FaqAccordion,
  FeatureModules,
  FinalCta,
  Hero,
  IntegrationsSection,
  MetricsBand,
  SecurityBand,
  TestimonialsSection,
} from "@/components/marketing/Sections";
import { PricingSection } from "@/components/marketing/PricingSection";

export const metadata: Metadata = {
  title: "Chefotech HRMS — HR, attendance, leave and payroll on your own rules",
  description:
    "A configurable HR platform for employee records, attendance, leave and payroll. Grace periods, half-day thresholds, accrual rates and salary formulas are settings you control.",
  alternates: { canonical: "/" },
};

/**
 * The home page.
 *
 * Ordered the way a buyer actually evaluates a system: what it is, what it
 * does, can I trust it with payroll data, does it connect to what we already
 * run, what does it cost, and then the objections that usually stop a deal.
 *
 * Sections are composed rather than written inline, so one can be reordered or
 * reused on another page without disturbing the rest.
 */
export default function HomePage() {
  return (
    <>
      <MarketingHeader />
      <main id="main">
        <Hero />
        <FeatureModules />
        <SecurityBand />
        <IntegrationsSection />
        {/* Both of these hide themselves until there is something real to show. */}
        <MetricsBand />
        <TestimonialsSection />
        <section className="border-b bg-[var(--surface-muted)]">
          <div className="mx-auto max-w-7xl px-5 py-16 lg:py-20">
            <PricingSection />
          </div>
        </section>
        <FaqAccordion />
        <FinalCta />
      </main>
      <MarketingFooter />
    </>
  );
}
