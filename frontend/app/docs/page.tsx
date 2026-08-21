import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import { DOC_CATEGORIES, articlesInCategory } from "@/content/docs";
import { MarketingPage, Section } from "@/components/marketing/Page";

export const metadata: Metadata = {
  title: "Documentation",
  description:
    "How every part of Chefotech HRMS works — attendance policies, leave rules, payroll formulas, biometric devices and administration.",
  alternates: { canonical: "/docs" },
};

export default function DocsIndexPage() {
  return (
    <MarketingPage
      eyebrow="Documentation"
      title="How the platform works"
      intro="Every feature, explained in terms of what it is for before what the buttons do. The same articles appear inside the product, so nothing here is out of step with what you are looking at."
    >
      {DOC_CATEGORIES.map((category) => {
        const articles = articlesInCategory(category.id);
        if (!articles.length) return null;
        return (
          <Section key={category.id} title={category.title} description={category.description}>
            <ul className="grid gap-3 sm:grid-cols-2">
              {articles.map((article) => (
                <li key={article.slug}>
                  <Link
                    href={`/docs/${article.slug}`}
                    className="flex h-full flex-col rounded-xl border bg-[var(--surface)] p-4 transition-colors hover:border-brand-300 hover:bg-[var(--surface-muted)]"
                  >
                    <span className="flex items-start gap-2">
                      <BookOpen
                        className="mt-0.5 h-4 w-4 shrink-0 text-brand-600"
                        aria-hidden
                      />
                      <span className="text-[14.5px] font-semibold text-[var(--text)]">
                        {article.title}
                      </span>
                    </span>
                    <span className="mt-1.5 text-[13px] leading-relaxed text-[var(--text-muted)]">
                      {article.summary}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        );
      })}
    </MarketingPage>
  );
}
