import type { Metadata } from "next";
import Link from "next/link";
import { MarketingPage, Section } from "@/components/marketing/Page";
import { COMPANY } from "@/content/company";

export const metadata: Metadata = {
  title: "Security",
  description:
    "How Chefotech HRMS protects employee data — tenant isolation, encryption, access control, audit logging and responsible disclosure.",
  alternates: { canonical: "/security" },
};

const PRACTICES = [
  {
    title: "Tenant isolation",
    body: "Each customer's data is separated at the data-access layer rather than by a filter that application code has to remember to apply. A database query issued without an authenticated tenant context fails outright instead of returning everything. Cross-tenant reads are refused and reported as not-found, so a probe cannot even confirm that another organisation exists.",
  },
  {
    title: "Encryption",
    body: "All traffic is TLS-encrypted in transit. Data is encrypted at rest, including backups. Passwords are hashed with a slow, salted algorithm and are never recoverable — a reset issues a new one rather than revealing the old.",
  },
  {
    title: "Authentication and sessions",
    body: "Short-lived access tokens paired with rotating refresh tokens. Reusing a refresh token invalidates the entire family, so a stolen token stops working the moment the legitimate one is used. Account owners control password strength, session lifetime and lockout thresholds.",
  },
  {
    title: "Access control",
    body: "Permissions are granular and roles are yours to define. Viewing is separate from managing throughout, and salary visibility is a separate permission from the rest of an employee record. Revoking access takes effect immediately rather than at next sign-in.",
  },
  {
    title: "Audit logging",
    body: "Sign-ins, permission changes, record and salary changes, payroll approval, attendance locks, exports and file access are all recorded with actor, timestamp, source address and before/after values. Entries are append-only and cannot be edited or selectively deleted from the product — including by an account owner.",
  },
  {
    title: "Input handling",
    body: "Salary formulas are evaluated by a purpose-built expression engine with no access to code execution, host objects or property lookup. Tenant-supplied formulas cannot run arbitrary code on our servers. Uploads are checked against per-category allow-lists, and SVG is always served as a download rather than as same-origin markup.",
  },
  {
    title: "Operational practice",
    body: "Development, staging and production are segregated, and production personal data is never copied into development or testing. Access to production is individually authenticated, time-limited and logged. Dependencies are monitored for known vulnerabilities.",
  },
  {
    title: "Backups and recovery",
    body: "Databases are backed up daily and retained for 30 days, with restores tested regularly rather than assumed to work. Recovery point objective 24 hours, recovery time objective 8 hours.",
  },
];

export default function SecurityPage() {
  return (
    <MarketingPage
      eyebrow="Security"
      title="How we protect employee data"
      intro="An HRMS holds some of the most sensitive data an organisation has — salaries, addresses, attendance patterns, medical leave. These are the controls that protect it, described plainly enough to be checked."
    >
      <Section>
        <div className="grid gap-3 sm:grid-cols-2">
          {PRACTICES.map((item) => (
            <div key={item.title} className="rounded-xl border bg-[var(--surface)] p-5">
              <h2 className="text-[15px] font-semibold text-[var(--text)]">{item.title}</h2>
              <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--text-muted)]">
                {item.body}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Reporting a vulnerability">
        <div className="rounded-xl border bg-[var(--surface)] p-5">
          <p className="text-[14px] leading-relaxed text-[var(--text-muted)]">
            Write to{" "}
            <a
              href={`mailto:${COMPANY.email.security}`}
              className="font-medium text-brand-700 underline underline-offset-2"
            >
              {COMPANY.email.security}
            </a>{" "}
            before you start testing, and we will agree a scope with you. We will acknowledge
            within two business days and keep you updated until it is resolved.
          </p>
          <p className="mt-3 text-[14px] leading-relaxed text-[var(--text-muted)]">
            We will not pursue legal action against researchers who stay within an agreed scope,
            avoid accessing other customers&apos; data, and give us a reasonable chance to fix
            what they find before disclosing it.
          </p>
        </div>
      </Section>

      <Section title="What we do not claim">
        <div className="rounded-xl border border-[var(--warning-border,#fed7aa)] bg-[var(--warning-bg,#fffbeb)] p-5">
          <p className="text-[14px] leading-relaxed text-[var(--text-muted)]">
            We do not currently hold ISO 27001 or SOC 2 certification, and this page does not
            claim otherwise. The controls described above are implemented and can be
            demonstrated; independent certification is a separate exercise, and a vendor page
            that implies one it has not completed is worth less than an honest list.
          </p>
          <p className="mt-3 text-[14px] leading-relaxed text-[var(--text-muted)]">
            If your procurement process needs a security questionnaire completed or a review of
            our sub-processors, write to{" "}
            <a
              href={`mailto:${COMPANY.email.security}`}
              className="font-medium text-brand-700 underline underline-offset-2"
            >
              {COMPANY.email.security}
            </a>
            .
          </p>
        </div>
      </Section>

      <Section title="Related">
        <ul className="space-y-2 text-[14px]">
          {[
            ["Data Processing Addendum", "/legal/data-processing"],
            ["Sub-processors", "/legal/sub-processors"],
            ["Privacy policy", "/legal/privacy"],
            ["Service level agreement", "/legal/sla"],
          ].map(([label, href]) => (
            <li key={href}>
              <Link href={href} className="text-brand-700 hover:underline">
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </Section>
    </MarketingPage>
  );
}
