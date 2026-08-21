import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";
import { DOCS_BY_SLUG, DOC_ARTICLES, DOC_CATEGORIES } from "@/content/docs";
import { MarketingHeader, MarketingFooter } from "@/components/marketing/Chrome";
import { COMPANY } from "@/content/company";

export function generateStaticParams() {
  return DOC_ARTICLES.map((article) => ({ slug: article.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = DOCS_BY_SLUG[slug];
  if (!article) return { title: "Not found" };
  return {
    title: article.title,
    description: article.summary,
    alternates: { canonical: `/docs/${article.slug}` },
  };
}

export default async function DocArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = DOCS_BY_SLUG[slug];
  if (!article) notFound();

  const category = DOC_CATEGORIES.find((entry) => entry.id === article.category);
  const related = (article.related ?? [])
    .map((relatedSlug) => DOCS_BY_SLUG[relatedSlug])
    .filter(Boolean);

  return (
    <>
      <MarketingHeader />

      <main id="main" className="mx-auto max-w-3xl px-5 py-12 lg:py-16">
        <Link
          href="/docs"
          className="inline-flex items-center gap-1.5 text-[13px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          All documentation
        </Link>

        <article className="mt-6">
          <header className="border-b pb-6">
            {category && (
              <p className="text-[12.5px] font-semibold uppercase tracking-wider text-brand-600">
                {category.title}
              </p>
            )}
            <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-tight text-[var(--text)]">
              {article.title}
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-[var(--text-muted)]">
              {article.summary}
            </p>

            {article.appPath && (
              // Reading about a feature and then hunting for it is a small
              // friction that repeats on every article.
              <Link
                href={article.appPath}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg border bg-[var(--surface)] px-3 py-1.5 text-[13px] font-medium text-[var(--text)] transition-colors hover:bg-[var(--surface-muted)]"
              >
                Open this in the app
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </Link>
            )}
          </header>

          <div className="mt-8 space-y-9">
            {article.sections.map((section) => (
              <section key={section.heading}>
                <h2 className="text-[17px] font-semibold text-[var(--text)]">
                  {section.heading}
                </h2>
                <div className="mt-3 space-y-3">
                  {section.body.map((block, index) =>
                    Array.isArray(block) ? (
                      <ul
                        key={index}
                        className="ml-1 space-y-2 border-l-2 border-[var(--border)] pl-4"
                      >
                        {block.map((item) => (
                          <li
                            key={item}
                            className="text-[14.5px] leading-relaxed text-[var(--text-muted)]"
                          >
                            {item}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p
                        key={index}
                        className="text-[14.5px] leading-relaxed text-[var(--text-muted)]"
                      >
                        {block}
                      </p>
                    )
                  )}
                </div>
              </section>
            ))}
          </div>

          {article.tourId && (
            <div className="mt-10 rounded-xl border border-brand-200 bg-brand-50 p-5">
              <h2 className="text-[14.5px] font-semibold text-brand-900">
                There is a guided walkthrough for this
              </h2>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-brand-800">
                Sign in and open Help, then ask about this feature. The walkthrough drives the
                real screens and fills the real form as you answer its questions — it is not a
                video or a slideshow.
              </p>
            </div>
          )}

          {related.length > 0 && (
            <section className="mt-10 border-t pt-6">
              <h2 className="text-[13px] font-semibold uppercase tracking-wider text-[var(--text-subtle)]">
                Related
              </h2>
              <ul className="mt-3 space-y-2">
                {related.map((entry) => (
                  <li key={entry.slug}>
                    <Link
                      href={`/docs/${entry.slug}`}
                      className="group inline-flex items-center gap-1.5 text-[14px] text-brand-700 hover:underline"
                    >
                      {entry.title}
                      <ArrowRight
                        className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <footer className="mt-10 rounded-xl border bg-[var(--surface-muted)] p-5">
            <p className="text-[13.5px] leading-relaxed text-[var(--text-muted)]">
              Something unclear or missing here?{" "}
              <Link href="/contact" className="font-medium text-brand-700 underline underline-offset-2">
                Tell us
              </Link>{" "}
              or write to{" "}
              <a
                href={`mailto:${COMPANY.email.support}`}
                className="font-medium text-brand-700 underline underline-offset-2"
              >
                {COMPANY.email.support}
              </a>
              .
            </p>
          </footer>
        </article>
      </main>

      <MarketingFooter />
    </>
  );
}
