import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LEGAL_BY_SLUG, LEGAL_DOCUMENTS } from "@/content/legal";
import { COMPANY } from "@/content/company";
import { MarketingHeader, MarketingFooter } from "@/components/marketing/Chrome";

/**
 * One route renders every legal document.
 *
 * The documents are data, so adding a policy is a content change rather than a
 * new page — which also means the index, the footer and the sitemap cannot
 * fall out of step with what actually exists.
 */

export function generateStaticParams() {
  return LEGAL_DOCUMENTS.map((doc) => ({ slug: doc.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const doc = LEGAL_BY_SLUG[slug];
  if (!doc) return { title: "Not found" };
  return {
    title: doc.title,
    description: doc.summary,
    alternates: { canonical: `/legal/${doc.slug}` },
  };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = LEGAL_BY_SLUG[slug];
  if (!doc) notFound();

  return (
    <>
      <MarketingHeader />

      <main id="main" className="mx-auto max-w-6xl px-5 py-12 lg:py-16">
        <div className="lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-12">
          {/* Every policy is one click from every other, so a reader checking
              how the terms and the DPA fit together never has to go back. */}
          <nav aria-label="Legal documents" className="mb-10 lg:mb-0">
            <p className="text-[12px] font-semibold uppercase tracking-wider text-[var(--text-subtle)]">
              Legal
            </p>
            <ul className="mt-3 space-y-1">
              {LEGAL_DOCUMENTS.map((entry) => (
                <li key={entry.slug}>
                  <Link
                    href={`/legal/${entry.slug}`}
                    aria-current={entry.slug === doc.slug ? "page" : undefined}
                    className={
                      entry.slug === doc.slug
                        ? "block rounded-md bg-brand-50 px-3 py-1.5 text-[13.5px] font-medium text-brand-700"
                        : "block rounded-md px-3 py-1.5 text-[13.5px] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
                    }
                  >
                    {entry.title}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <article className="min-w-0">
            <header className="border-b pb-6">
              <h1 className="text-[28px] font-semibold tracking-tight text-[var(--text)]">
                {doc.title}
              </h1>
              <p className="mt-2 text-[14.5px] leading-relaxed text-[var(--text-muted)]">
                {doc.summary}
              </p>
              <p className="mt-3 text-[13px] text-[var(--text-subtle)]">
                Last updated{" "}
                <time dateTime={doc.updated}>{formatDate(doc.updated)}</time> ·{" "}
                {COMPANY.legalName}
              </p>
            </header>

            <div className="mt-8 space-y-9">
              {doc.sections.map((section) => (
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

            <footer className="mt-12 rounded-xl border bg-[var(--surface-muted)] p-5">
              <p className="text-[13.5px] leading-relaxed text-[var(--text-muted)]">
                Questions about this document? Write to{" "}
                <a
                  href={`mailto:${COMPANY.email.legal}`}
                  className="font-medium text-brand-700 underline underline-offset-2"
                >
                  {COMPANY.email.legal}
                </a>
                . For privacy requests specifically, use{" "}
                <a
                  href={`mailto:${COMPANY.email.privacy}`}
                  className="font-medium text-brand-700 underline underline-offset-2"
                >
                  {COMPANY.email.privacy}
                </a>
                .
              </p>
            </footer>
          </article>
        </div>
      </main>

      <MarketingFooter />
    </>
  );
}
