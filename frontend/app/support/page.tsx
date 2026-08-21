import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, LifeBuoy, Mail, MessageSquare, ShieldAlert } from "lucide-react";
import { MarketingPage, Section, Card } from "@/components/marketing/Page";
import { COMPANY } from "@/content/company";
import { DOC_ARTICLES } from "@/content/docs";

export const metadata: Metadata = {
  title: "Support",
  description:
    "Documentation, guided walkthroughs, response-time targets and how to reach a person at Chefotech.",
  alternates: { canonical: "/support" },
};

/** The questions support actually receives, answered rather than deflected. */
const COMMON = [
  {
    q: "An employee says their leave cost more days than they expected",
    a: "That is the counting rule on the leave type. Depending on the setting, non-working days inside a request can be excluded, counted in full, or counted only when leave falls on both sides of them.",
    href: "/docs/sandwich-rule",
  },
  {
    q: "Someone forgot to punch out and the day looks wrong",
    a: "Your attendance policy decides what a missing punch means, and employees can raise a correction request from their portal that recalculates the day once approved.",
    href: "/docs/attendance-corrections",
  },
  {
    q: "Our biometric device is on the office LAN and will not sync",
    a: "A cloud service cannot reach a device on a private network. Use webhook mode with the LAN bridge, or file import — neither requires opening your network.",
    href: "/docs/biometric-devices",
  },
  {
    q: "Payroll shows exceptions and I do not know what to do with them",
    a: "An exception is an employee whose payslip the engine could not compute confidently — usually a missing salary structure or a formula referencing something unavailable. The rest of the run completes regardless.",
    href: "/docs/payroll-run",
  },
  {
    q: "A night shift is producing two attendance records",
    a: "It should produce one, dated to the night the shift started. Check that the shift's end time is earlier than its start time so the platform treats it as crossing midnight.",
    href: "/docs/shifts",
  },
];

export default function SupportPage() {
  return (
    <MarketingPage
      eyebrow="Support"
      title="Help, and how to reach us"
      intro="Most questions have an answer in the documentation or a guided walkthrough inside the product. When they do not, a person replies."
    >
      <Section title="Start here">
        <div className="grid gap-3 sm:grid-cols-3">
          <Card title="Documentation" icon={<BookOpen className="h-5 w-5" />}>
            {DOC_ARTICLES.length} articles covering every feature.{" "}
            <Link href="/docs" className="font-medium text-brand-700 hover:underline">
              Browse
            </Link>
          </Card>
          <Card title="Guided walkthroughs" icon={<LifeBuoy className="h-5 w-5" />}>
            Sign in, open Help, ask in your own words. The walkthrough drives the real screens
            and fills the real form.
          </Card>
          <Card title="Email support" icon={<Mail className="h-5 w-5" />}>
            <a
              href={`mailto:${COMPANY.email.support}`}
              className="font-medium text-brand-700 hover:underline"
            >
              {COMPANY.email.support}
            </a>
            <br />
            {COMPANY.supportHours}.
          </Card>
        </div>
      </Section>

      <Section
        title="Questions we actually get"
        description="With the real answer, not a link to a ticket form."
      >
        <ul className="divide-y rounded-xl border bg-[var(--surface)]">
          {COMMON.map((item) => (
            <li key={item.q} className="p-5">
              <h3 className="text-[14.5px] font-semibold text-[var(--text)]">{item.q}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--text-muted)]">
                {item.a}
              </p>
              <Link
                href={item.href}
                className="mt-2 inline-block text-[13px] font-medium text-brand-700 hover:underline"
              >
                Read more
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Response times"
        description="Targets for a first substantive response during support hours, not an automated acknowledgement."
      >
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[520px] text-left text-[13.5px]">
            <thead className="bg-[var(--surface-muted)] text-[var(--text)]">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-semibold">
                  Priority
                </th>
                <th scope="col" className="px-4 py-2.5 font-semibold">
                  What it means
                </th>
                <th scope="col" className="px-4 py-2.5 font-semibold">
                  First response
                </th>
              </tr>
            </thead>
            <tbody className="divide-y text-[var(--text-muted)]">
              {[
                ["Critical", "Service unavailable, or payroll cannot be processed", "2 hours"],
                ["High", "A major function is broken with no workaround", "1 business day"],
                ["Normal", "A function is impaired but has a workaround", "2 business days"],
                ["Low", "Questions, guidance, feature requests", "5 business days"],
              ].map(([priority, meaning, target]) => (
                <tr key={priority}>
                  <td className="px-4 py-2.5 font-medium text-[var(--text)]">{priority}</td>
                  <td className="px-4 py-2.5">{meaning}</td>
                  <td className="px-4 py-2.5 tabular-nums">{target}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[13px] text-[var(--text-subtle)]">
          These targets are contractual for paid plans — see the{" "}
          <Link href="/legal/sla" className="text-brand-700 underline underline-offset-2">
            Service Level Agreement
          </Link>
          .
        </p>
      </Section>

      <Section title="Reporting something urgent">
        <div className="grid gap-3 sm:grid-cols-2">
          <Card title="Security issues" icon={<ShieldAlert className="h-5 w-5" />}>
            Write to{" "}
            <a
              href={`mailto:${COMPANY.email.security}`}
              className="font-medium text-brand-700 hover:underline"
            >
              {COMPANY.email.security}
            </a>
            . We will not pursue legal action against researchers who follow an agreed scope and
            give us a reasonable chance to fix what they find.
          </Card>
          <Card title="Privacy requests" icon={<MessageSquare className="h-5 w-5" />}>
            Write to{" "}
            <a
              href={`mailto:${COMPANY.email.privacy}`}
              className="font-medium text-brand-700 hover:underline"
            >
              {COMPANY.email.privacy}
            </a>
            . If your employer holds the data, they control it and are the right place to ask —
            we will tell you so and let them know you asked.
          </Card>
        </div>
      </Section>
    </MarketingPage>
  );
}
