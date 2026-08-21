import type { Metadata } from "next";
import Link from "next/link";
import { MarketingPage, Section, Prose } from "@/components/marketing/Page";
import { COMPANY, formattedAddress } from "@/content/company";

export const metadata: Metadata = {
  title: "About",
  description: `${COMPANY.legalName} builds ${COMPANY.product}, a configurable HR platform for organisations that need their own rules.`,
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <MarketingPage
      eyebrow="About"
      title={`Why we built ${COMPANY.product}`}
      intro="HR software usually fails in the same place: the moment an organisation's actual rules meet a product built around someone else's."
    >
      <Section>
        <Prose>
          <p>
            Every organisation counts a working day slightly differently. One treats a weekend
            inside a leave request as free; another deducts it only when leave falls on both
            sides. One forgives a five-minute late arrival; another counts three of them as half
            a day. None of these is unusual, and none of them is wrong.
          </p>
          <p>
            What is wrong is a system that hard-codes one answer and calls the others edge cases.
            That is how HR teams end up maintaining a spreadsheet beside the HR system, which is
            the thing the HR system was bought to eliminate.
          </p>
          <p>
            So the rules here are configuration rather than code. Attendance policies, leave
            counting modes, accrual rates, carry-forward caps and salary formulas are all things
            an administrator sets — and changing them is a setting, not a support ticket and not
            a release.
          </p>
        </Prose>
      </Section>

      <Section title="What we believe about software that holds payroll">
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            {
              title: "A number nobody can explain is a liability",
              body: "Every calculated figure carries its working — which rule fired, on which input. If an employee disputes a deduction, the answer should be on the screen rather than in someone's memory.",
            },
            {
              title: "Isolation is architecture, not diligence",
              body: "Multi-tenant separation that depends on every developer remembering a filter will fail eventually. Ours fails closed: a query without a tenant context throws rather than returning data.",
            },
            {
              title: "Do not silently discard the original",
              body: "Raw device events are kept beside the attendance computed from them. A mis-mapped device is a fixable mistake instead of a lost month.",
            },
            {
              title: "Say what the product does not do",
              body: "We do not hold certifications we have not earned, and we do not claim the platform guarantees statutory compliance — it applies the rules you configure, and those rules are yours.",
            },
          ].map((item) => (
            <div key={item.title} className="rounded-xl border bg-[var(--surface)] p-5">
              <h3 className="text-[15px] font-semibold text-[var(--text)]">{item.title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--text-muted)]">
                {item.body}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Company">
        <dl className="space-y-1.5 text-[13.5px] text-[var(--text-muted)]">
          <div>
            <dt className="inline font-medium text-[var(--text)]">Registered entity: </dt>
            <dd className="inline">{COMPANY.legalName}</dd>
          </div>
          <div>
            <dt className="inline font-medium text-[var(--text)]">Registered office: </dt>
            <dd className="inline">{formattedAddress()}</dd>
          </div>
          <div>
            <dt className="inline font-medium text-[var(--text)]">Enquiries: </dt>
            <dd className="inline">
              <a href={`mailto:${COMPANY.email.sales}`} className="text-brand-700 hover:underline">
                {COMPANY.email.sales}
              </a>
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-[13.5px] text-[var(--text-muted)]">
          Full company and regulatory details are on the{" "}
          <Link href="/legal" className="text-brand-700 underline underline-offset-2">
            legal page
          </Link>
          .
        </p>
      </Section>
    </MarketingPage>
  );
}
