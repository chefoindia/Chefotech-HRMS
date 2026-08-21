import type { Metadata } from "next";
import Link from "next/link";
import { MarketingPage, Section } from "@/components/marketing/Page";
import { PricingSection } from "@/components/marketing/PricingSection";
import { FaqSection } from "@/components/marketing/FaqSection";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Per-employee pricing with a free trial, no setup fee and no charge for employees who have left.",
  alternates: { canonical: "/pricing" },
};

const BILLING_FACTS = [
  {
    q: "What counts as a billable employee?",
    a: "An active employee record. People who have left are marked as such and stop counting, but their records and history stay for your reporting and statutory obligations — you are not charged to keep them, and you are not forced to delete them to save money.",
  },
  {
    q: "What happens when we reach a plan limit?",
    a: "The platform tells you before you reach it, and refuses the action that would exceed it rather than quietly accepting data it cannot bill for. Nothing is ever deleted for being over a limit.",
  },
  {
    q: "Is there a setup fee or a minimum contract?",
    a: "No setup fee, and monthly plans have no minimum term. Annual plans are billed for the year and carry a 14-day full refund window from the initial purchase.",
  },
  {
    q: "What happens when the trial ends?",
    a: "The account becomes read-only rather than being deleted. Nothing is lost while you decide, and subscribing restores full access with your configuration intact.",
  },
  {
    q: "Can we change plans later?",
    a: "Upgrade at any time, charged pro-rata for the rest of the period. Downgrades take effect at the next renewal so you keep what you have already paid for.",
  },
  {
    q: "How do we cancel?",
    a: "From Settings → Plan and usage, or by email. No notice period, no cancellation fee, and export stays available. See the cancellation and refund policy for the detail.",
  },
];

export default function PricingPage() {
  return (
    <MarketingPage
      eyebrow="Pricing"
      title="Priced per employee, with nothing hidden"
      intro="Start on a free trial that is a full account rather than a limited sandbox. Configure your real policies and see what the engine does with them before you pay anything."
      cta={false}
    >
      <PricingSection />

      <Section
        title="How billing actually works"
        description="The questions that decide whether a price is really the price."
      >
        <ul className="divide-y rounded-xl border bg-[var(--surface)]">
          {BILLING_FACTS.map((item) => (
            <li key={item.q} className="p-5">
              <h3 className="text-[14.5px] font-semibold text-[var(--text)]">{item.q}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--text-muted)]">
                {item.a}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[13.5px] text-[var(--text-muted)]">
          Full detail in the{" "}
          <Link href="/legal/refunds" className="text-brand-700 underline underline-offset-2">
            cancellation and refund policy
          </Link>{" "}
          and the{" "}
          <Link href="/legal/terms" className="text-brand-700 underline underline-offset-2">
            terms of service
          </Link>
          .
        </p>
      </Section>

      <FaqSection />
    </MarketingPage>
  );
}
