"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, ExternalLink, LifeBuoy, Mail, Search, Sparkles } from "lucide-react";
import { DOC_ARTICLES, isCode } from "@/content/docs";
import { COMPANY } from "@/content/company";
import { Card, EmptyState, PageHeader } from "@/components/ui";

/**
 * Help, for an employee.
 *
 * The admin help centre lives under /app, which a self-service employee is
 * redirected out of — so before this page they had exactly one support
 * affordance, the "?" in the top bar, and no way to browse or search
 * anything. This is the same documentation, narrowed to the parts an
 * employee can actually act on: nobody in the portal is configuring payroll
 * components.
 */

/** Categories an employee can do something about. */
const EMPLOYEE_CATEGORIES = ["getting-started", "attendance", "leave", "people"];

const QUICK_ANSWERS: { question: string; answer: string; href?: string }[] = [
  {
    question: "How do I check in and out?",
    answer:
      "Press the check-in button on your home screen. It records the time immediately, and your location only if your employer's policy asks for it. Forgot to check out? Raise a correction from My attendance.",
    href: "/me",
  },
  {
    question: "How do I apply for leave?",
    answer:
      "My leave → Apply. Pick the type and dates, and the screen shows exactly how many days will be deducted — including whether a weekend or holiday inside your dates counts — before you submit.",
    href: "/me/leave",
  },
  {
    question: "Where is my payslip?",
    answer:
      "My payslips, as soon as payroll publishes each month. Open one to see every earning and deduction, and download the PDF for a bank or a visa application.",
    href: "/me/payslips",
  },
  {
    question: "A day on my attendance looks wrong",
    answer:
      "Open My attendance and select the day. It shows the punches and the exact rule that decided its status, and lets you request a correction, which goes to your manager.",
    href: "/me/attendance",
  },
  {
    question: "How do I claim what I spent for work?",
    answer:
      "My expenses → New claim. Add a line per expense with a receipt photo, then submit. Approved claims are paid with your salary or by transfer.",
    href: "/me/expenses",
  },
  {
    question: "Something is broken and I need help",
    answer:
      "Help desk → Raise a ticket. Pick IT, HR, payroll or facilities and the right team picks it up; you can follow the replies and reopen it if the problem comes back.",
    href: "/me/tickets",
  },
];

export default function PortalHelpPage() {
  const [query, setQuery] = useState("");

  const articles = useMemo(
    () => DOC_ARTICLES.filter((article) => EMPLOYEE_CATEGORIES.includes(article.category)),
    []
  );

  const results = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return null;

    const inAnswers = QUICK_ANSWERS.filter((item) =>
      `${item.question} ${item.answer}`.toLowerCase().includes(text)
    );
    const inArticles = articles.filter((article) => {
      const haystack = [
        article.title,
        article.summary,
        ...article.sections.map((section) => section.heading),
        ...article.sections.flatMap((section) =>
          section.body.flatMap((block) => (isCode(block) ? [block.code] : Array.isArray(block) ? block : [block]))
        ),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(text);
    });
    return { inAnswers, inArticles };
  }, [articles, query]);

  return (
    <>
      <PageHeader
        title="Help"
        description="Answers to the things people ask most, and the full documentation. For anything else, the ? button at the top of the screen answers questions in your own words."
      />

      <div className="relative mb-5">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-subtle)]" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search — leave, payslip, attendance, expenses…"
          aria-label="Search help"
          className="w-full rounded-lg border bg-[var(--surface)] py-2.5 pl-9 pr-3 text-[14px] text-[var(--text)] outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
      </div>

      {results ? (
        <div className="space-y-5">
          {results.inAnswers.length === 0 && results.inArticles.length === 0 ? (
            <Card>
              <EmptyState
                icon={<LifeBuoy className="h-5 w-5" />}
                title="Nothing matched"
                description="Try another word, or ask the help assistant with the ? button at the top of the screen — it understands questions written normally."
              />
            </Card>
          ) : (
            <>
              {results.inAnswers.length > 0 && (
                <section className="space-y-2.5">
                  {results.inAnswers.map((item) => (
                    <QuickAnswer key={item.question} {...item} />
                  ))}
                </section>
              )}
              {results.inArticles.length > 0 && (
                <Card>
                  <h2 className="text-[15px] font-semibold text-[var(--text)]">Documentation</h2>
                  <ul className="mt-3 space-y-2">
                    {results.inArticles.map((article) => (
                      <li key={article.slug}>
                        <ArticleLink slug={article.slug} title={article.title} summary={article.summary} />
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          <section>
            <h2 className="mb-2.5 text-[15px] font-semibold text-[var(--text)]">Common questions</h2>
            <div className="space-y-2.5">
              {QUICK_ANSWERS.map((item) => (
                <QuickAnswer key={item.question} {...item} />
              ))}
            </div>
          </section>

          <Card>
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
                <Sparkles className="h-4.5 w-4.5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-semibold text-[var(--text)]">Ask in your own words</h2>
                <p className="mt-1 text-[13.5px] leading-relaxed text-[var(--text-muted)]">
                  The <strong className="text-[var(--text)]">?</strong> button at the top of every screen takes a question the way you would
                  say it — &ldquo;how many leaves do I have left&rdquo; — and takes you to the right screen. Press{" "}
                  <kbd className="rounded border bg-[var(--surface-muted)] px-1.5 py-0.5 font-sans text-[11px]">?</kbd> anywhere to open it.
                </p>
              </div>
            </div>
          </Card>

          <section>
            <h2 className="mb-2.5 text-[15px] font-semibold text-[var(--text)]">Full documentation</h2>
            <Card>
              <ul className="space-y-2">
                {articles.map((article) => (
                  <li key={article.slug}>
                    <ArticleLink slug={article.slug} title={article.title} summary={article.summary} />
                  </li>
                ))}
              </ul>
            </Card>
          </section>

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--surface-sunken)] text-[var(--text-muted)]">
                  <Mail className="h-4.5 w-4.5" aria-hidden />
                </span>
                <div>
                  <h2 className="text-[15px] font-semibold text-[var(--text)]">Still stuck?</h2>
                  <p className="mt-0.5 text-[13.5px] text-[var(--text-muted)]">
                    Your HR team can fix anything about your own record. For a problem with the app itself, raise a help desk ticket.
                  </p>
                </div>
              </div>
              <Link
                href="/me/tickets"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 text-[13.5px] font-medium text-white transition-colors hover:bg-brand-700"
              >
                <LifeBuoy className="h-4 w-4" aria-hidden />
                Raise a ticket
              </Link>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

function QuickAnswer({ question, answer, href }: { question: string; answer: string; href?: string }) {
  return (
    <Card>
      <h3 className="text-[14px] font-semibold text-[var(--text)]">{question}</h3>
      <p className="mt-1 text-[13.5px] leading-relaxed text-[var(--text-muted)]">{answer}</p>
      {href && (
        <Link href={href} className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-600 hover:underline">
          Take me there
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </Link>
      )}
    </Card>
  );
}

function ArticleLink({ slug, title, summary }: { slug: string; title: string; summary: string }) {
  return (
    <Link
      href={`/docs/${slug}`}
      className="flex items-start gap-3 rounded-lg border border-[var(--border)] p-3 transition-colors hover:border-brand-300 hover:bg-[var(--surface-muted)]"
    >
      <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-subtle)]" aria-hidden />
      <span className="min-w-0">
        <span className="block text-[13.5px] font-medium text-[var(--text)]">{title}</span>
        <span className="block text-[12.5px] leading-relaxed text-[var(--text-muted)]">{summary}</span>
      </span>
    </Link>
  );
}
