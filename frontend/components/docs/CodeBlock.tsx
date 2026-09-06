"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A block of code someone is meant to run.
 *
 * Every example in the documentation is something the reader will paste into
 * a terminal or an editor, so the copy button is part of the block rather
 * than an afterthought — and the language is labelled, because a reader
 * scanning for the Python example should not have to parse syntax to find it.
 */
export function CodeBlock({
  code,
  language,
  caption,
  className,
}: {
  code: string;
  language?: string;
  caption?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard
      .writeText(code)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => undefined);
  };

  return (
    <figure className={cn("overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)]", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wider text-[var(--text-subtle)]">
          {language || "text"}
        </span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-[12px] font-medium text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-sunken)] hover:text-[var(--text)]"
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-[var(--success)]" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {/* Wide commands must scroll inside the block, never widen the page. */}
      <pre className="overflow-x-auto p-3 text-[12.5px] leading-relaxed">
        <code className="font-mono text-[var(--text)]">{code}</code>
      </pre>
      {caption && (
        <figcaption className="border-t border-[var(--border)] px-3 py-1.5 text-[12px] text-[var(--text-muted)]">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}

/**
 * The same snippet in several languages. Integrators arrive knowing one
 * language and wanting to leave in two minutes; making them mentally port a
 * curl example is how that becomes twenty.
 */
export function CodeTabs({ samples, className }: { samples: { label: string; language: string; code: string }[]; className?: string }) {
  const [active, setActive] = useState(samples[0]?.label);
  const current = samples.find((s) => s.label === active) || samples[0];

  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {samples.map((sample) => (
          <button
            key={sample.label}
            type="button"
            onClick={() => setActive(sample.label)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-[12.5px] font-medium transition-colors",
              sample.label === current.label
                ? "border-brand-600 bg-brand-50 text-brand-700"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)]"
            )}
          >
            {sample.label}
          </button>
        ))}
      </div>
      <CodeBlock code={current.code} language={current.language} />
    </div>
  );
}
