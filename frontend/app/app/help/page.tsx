"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, BookOpen, LifeBuoy, Mail, Search, Sparkles } from "lucide-react";
import { DOC_CATEGORIES, DOC_ARTICLES, articlesInCategory } from "@/content/docs";
import { COMPANY } from "@/content/company";

/**
 * The in-app help centre.
 *
 * Reads the same articles as the public documentation site, so an admin
 * looking something up inside the product and a buyer reading the docs
 * beforehand see the same words. Each article links to the screen it
 * describes, because "Settings → Attendance" is a worse instruction than a
 * link that goes there.
 */
export default function HelpCentrePage() {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return null;
    return DOC_ARTICLES.filter((article) => {
      const haystack = [
        article.title,
        article.summary,
        ...article.sections.map((section) => section.heading),
        // Search the body too — people search for the phrase they saw on
        // screen ("sandwich"), not for the title of the article about it.
        ...article.sections.flatMap((section) =>
          section.body.flatMap((block) => (Array.isArray(block) ? block : [block]))
        ),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(text);
    });
  }, [query]);

  return (
    <>
      <header className="mb-6">
        <h1 className="text-[22px] font-semibold tracking-tight text-[var(--text)]">
          Help centre
        </h1>
        <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--text-muted)]">
          How every part of the platform works. For a walkthrough that drives the real screens,
          open Help from the top bar and ask in your own words.
        </p>
      </header>

      <div className="relative mb-6">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-subtle)]"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search the documentation…"
          aria-label="Search the documentation"
          className="w-full rounded-lg border bg-[var(--surface)] py-2.5 pl-9 pr-3 text-[14px] text-[var(--text)] outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
      </div>

      {results ? (
        <section>
          <p className="mb-3 text-[13px] text-[var(--text-muted)]">
            {results.length === 0
              ? "Nothing matched. Try a different word, or ask the help assistant in the top bar."
              : `${results.length} article${results.length === 1 ? "" : "s"} matched.`}
          </p>
          <ul className="space-y-2">
            {results.map((article) => (
              <li key={article.slug}>
                <ArticleRow slug={article.slug} title={article.title} summary={article.summary} />
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <>
          <div className="mb-8 grid gap-3 sm:grid-cols-3">
            <QuickCard
              icon={<Sparkles className="h-4 w-4" />}
              title="Guided walkthroughs"
              body="Open Help in the top bar and describe what you want to do. The walkthrough fills the real form as you answer."
            />
            <QuickCard
              icon={<BookOpen className="h-4 w-4" />}
              title="Setup checklist"
              body="Your dashboard tracks what is still outstanding, in the order that avoids rework."
              href="/onboarding"
              linkLabel="Open the checklist"
            />
            <QuickCard
              icon={<Mail className="h-4 w-4" />}
              title="Contact support"
              body={`${COMPANY.email.support} — ${COMPANY.supportHours}.`}
              href={`mailto:${COMPANY.email.support}`}
              linkLabel="Email us"
              external
            />
          </div>

          {DOC_CATEGORIES.map((category) => {
            const articles = articlesInCategory(category.id);
            if (!articles.length) return null;
            return (
              <section key={category.id} className="mb-8">
                <h2 className="text-[15px] font-semibold text-[var(--text)]">{category.title}</h2>
                <p className="mt-1 text-[13.5px] text-[var(--text-muted)]">
                  {category.description}
                </p>
                <ul className="mt-3 space-y-2">
                  {articles.map((article) => (
                    <li key={article.slug}>
                      <ArticleRow
                        slug={article.slug}
                        title={article.title}
                        summary={article.summary}
                        appPath={article.appPath}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      )}

      <footer className="mt-10 flex items-start gap-3 rounded-xl border bg-[var(--surface-muted)] p-5">
        <LifeBuoy className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
        <p className="text-[13.5px] leading-relaxed text-[var(--text-muted)]">
          Still stuck? Write to{" "}
          <a
            href={`mailto:${COMPANY.email.support}`}
            className="font-medium text-brand-700 underline underline-offset-2"
          >
            {COMPANY.email.support}
          </a>{" "}
          and tell us what you were trying to do. Include the screen you were on — it saves a
          round trip.
        </p>
      </footer>
    </>
  );
}

function ArticleRow({
  slug,
  title,
  summary,
  appPath,
}: {
  slug: string;
  title: string;
  summary: string;
  appPath?: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border bg-[var(--surface)] p-4 transition-colors hover:border-brand-300">
      <div className="min-w-0 flex-1">
        <Link href={`/docs/${slug}`} className="group inline-flex items-center gap-1.5">
          <span className="text-[14px] font-semibold text-[var(--text)] group-hover:text-brand-700">
            {title}
          </span>
          <ArrowRight
            className="h-3.5 w-3.5 text-[var(--text-subtle)] transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </Link>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-muted)]">{summary}</p>
      </div>
      {appPath && (
        <Link
          href={appPath}
          className="shrink-0 rounded-md border px-2.5 py-1 text-[12.5px] font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
        >
          Open
        </Link>
      )}
    </div>
  );
}

function QuickCard({
  icon,
  title,
  body,
  href,
  linkLabel,
  external,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  href?: string;
  linkLabel?: string;
  external?: boolean;
}) {
  return (
    <div className="rounded-xl border bg-[var(--surface)] p-4">
      <div className="text-brand-600">{icon}</div>
      <h3 className="mt-2 text-[14px] font-semibold text-[var(--text)]">{title}</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-muted)]">{body}</p>
      {href &&
        linkLabel &&
        (external ? (
          <a
            href={href}
            className="mt-2 inline-block text-[13px] font-medium text-brand-700 hover:underline"
          >
            {linkLabel}
          </a>
        ) : (
          <Link
            href={href}
            className="mt-2 inline-block text-[13px] font-medium text-brand-700 hover:underline"
          >
            {linkLabel}
          </Link>
        ))}
    </div>
  );
}
