import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { LEGAL_DOCUMENTS } from "@/content/legal";
import { COMPANY, formattedAddress } from "@/content/company";
import { MarketingHeader, MarketingFooter } from "@/components/marketing/Chrome";

export const metadata: Metadata = {
  title: "Legal",
  description:
    "Terms of service, privacy policy, data processing addendum and the other agreements that govern Chefotech HRMS.",
  alternates: { canonical: "/legal" },
};

export default function LegalIndexPage() {
  return (
    <>
      <MarketingHeader />

      <main id="main" className="mx-auto max-w-4xl px-5 py-14 lg:py-20">
        <h1 className="text-[32px] font-semibold tracking-tight text-[var(--text)]">Legal</h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[var(--text-muted)]">
          Everything that governs how you use {COMPANY.product} and how we handle data, written
          to be read rather than to be skimmed past.
        </p>

        <ul className="mt-10 grid gap-3 sm:grid-cols-2">
          {LEGAL_DOCUMENTS.map((doc) => (
            <li key={doc.slug}>
              <Link
                href={`/legal/${doc.slug}`}
                className="group flex h-full flex-col rounded-xl border bg-[var(--surface)] p-5 transition-colors hover:border-brand-300 hover:bg-[var(--surface-muted)]"
              >
                <span className="flex items-center gap-2 text-[15px] font-semibold text-[var(--text)]">
                  {doc.title}
                  <ArrowRight
                    className="h-3.5 w-3.5 text-[var(--text-subtle)] transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </span>
                <span className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--text-muted)]">
                  {doc.summary}
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <section className="mt-12 rounded-xl border bg-[var(--surface-muted)] p-6">
          <h2 className="text-[15px] font-semibold text-[var(--text)]">Company details</h2>
          <dl className="mt-3 space-y-1.5 text-[13.5px] text-[var(--text-muted)]">
            <div>
              <dt className="inline font-medium text-[var(--text)]">Registered entity: </dt>
              <dd className="inline">{COMPANY.legalName}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-[var(--text)]">Registered office: </dt>
              <dd className="inline">{formattedAddress()}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-[var(--text)]">Registration number: </dt>
              <dd className="inline">{COMPANY.registrationNumber}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-[var(--text)]">Grievance Officer: </dt>
              <dd className="inline">
                {COMPANY.grievanceOfficer.name} —{" "}
                <a
                  href={`mailto:${COMPANY.grievanceOfficer.email}`}
                  className="text-brand-700 underline underline-offset-2"
                >
                  {COMPANY.grievanceOfficer.email}
                </a>
              </dd>
            </div>
          </dl>
        </section>
      </main>

      <MarketingFooter />
    </>
  );
}
