"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const FAQS = [
  {
    question: "Can we run our own attendance and leave rules?",
    answer:
      "Yes — that is the point of the product. Grace periods, late marks, half-day thresholds, overtime multipliers, leave accrual, carry forward and the sandwich rule are all settings. Two companies on the same platform can run completely different policies, and changing yours takes a minute rather than a support ticket.",
  },
  {
    question: "How do night shifts and rotating rosters work?",
    answer:
      "A shift whose end time is earlier than its start time is treated as crossing midnight automatically. A punch at 01:00 is attributed back to the night the shift started, so a night worker gets one attendance record for their shift rather than two half-days. Rosters can be assigned per employee for a date range without changing anyone's standing shift.",
  },
  {
    question: "Which biometric devices do you support?",
    answer:
      "The integration is built around an adapter interface rather than one manufacturer. Devices that expose a REST API can be polled directly, devices behind a firewall can push to us by webhook, and any device at all can be handled by uploading the log file its own software exports. Raw device events are stored untouched, so a device with a mis-mapped enrolment id can be reprocessed later without re-importing anything.",
  },
  {
    question: "What happens to attendance already recorded when we change a policy?",
    answer:
      "Nothing, until you ask. Existing records keep the result they were calculated with, and each one carries the rules that produced it. If you want the new policy applied historically, there is a recalculate action — and any period that payroll has locked is protected from it.",
  },
  {
    question: "Can an employee see another employee's salary?",
    answer:
      "No. Salary, bank details and identity documents sit behind a separate permission from the rest of a profile, and that is enforced by the API rather than by hiding a tab. An employee sees only their own record; a manager sees their reporting tree; only someone explicitly granted the sensitive-data permission sees compensation.",
  },
  {
    question: "How is our data kept separate from other companies?",
    answer:
      "Every record carries an organization id, and the scoping is applied in the data layer before a query reaches the database — not by each developer remembering to add a filter. A query written without a tenant scope raises an error rather than returning another company's data. Files follow the same rule: employee documents are streamed through an authenticated proxy and are never given a public link.",
  },
  {
    question: "Can we import our existing employee list?",
    answer:
      "Yes. Download the template — it already includes any custom fields you have created — map your columns, and you get a full validation report before anything is written. Rows with problems are listed with the reason, and you choose whether to import the valid ones or fix the file first. Nothing is ever half-imported without telling you.",
  },
  {
    question: "Do we need training to set it up?",
    answer:
      "The guided help is designed to replace it. Ask a question in your own words — “how do I configure half day?” — and the product opens the right screen, highlights the field, asks what value you want, validates it and saves. It performs the task with you rather than describing it in a manual.",
  },
];

export function FaqSection() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="mx-auto max-w-3xl px-5 py-20">
      <h2 className="text-3xl font-semibold tracking-tight text-[var(--text)]">
        Questions people ask before signing up
      </h2>

      <div className="mt-8 divide-y rounded-[var(--radius)] border">
        {FAQS.map((faq, index) => {
          const expanded = open === index;
          return (
            <div key={faq.question}>
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : index)}
                aria-expanded={expanded}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
              >
                <span className="text-[15px] font-medium text-[var(--text)]">{faq.question}</span>
                <ChevronDown
                  className={cn(
                    "h-4.5 w-4.5 shrink-0 text-[var(--text-subtle)] transition-transform",
                    expanded && "rotate-180"
                  )}
                  aria-hidden
                />
              </button>

              {expanded && (
                <p className="px-5 pb-5 text-[14px] leading-relaxed text-[var(--text-muted)]">
                  {faq.answer}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
