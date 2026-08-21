"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Mail, MapPin, ShieldCheck } from "lucide-react";
import { MarketingHeader, MarketingFooter } from "@/components/marketing/Chrome";
import { COMPANY, formattedAddress } from "@/content/company";
import { api, ApiError } from "@/lib/api";

/**
 * Contact and demo requests.
 *
 * The form posts to a real endpoint that stores the message and notifies the
 * right inbox. A contact page whose form silently discards what people type is
 * worse than a page that just prints an email address.
 */

const SUBJECTS = [
  { value: "sales", label: "Pricing and plans" },
  { value: "demo", label: "Request a demo" },
  { value: "support", label: "Help with my account" },
  { value: "partnership", label: "Partnership or reselling" },
  { value: "privacy", label: "Privacy or data request" },
  { value: "other", label: "Something else" },
];

export default function ContactPage() {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [reference, setReference] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // How long the form has been open, so the endpoint can reject submissions
  // that arrive faster than a person could have typed them.
  const openedAt = useRef<number>(0);
  useEffect(() => {
    openedAt.current = Date.now();
  }, []);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");
    setError(null);
    setFieldErrors({});

    const form = new FormData(event.currentTarget);
    const payload = {
      name: String(form.get("name") || ""),
      email: String(form.get("email") || ""),
      company: String(form.get("company") || ""),
      phone: String(form.get("phone") || ""),
      employeeCount: form.get("employeeCount") ? Number(form.get("employeeCount")) : undefined,
      subject: String(form.get("subject") || "sales"),
      message: String(form.get("message") || ""),
      consent: form.get("consent") === "on",
      website: String(form.get("website") || ""),
      elapsedMs: Date.now() - openedAt.current,
    };

    try {
      // api.post resolves the envelope, so the payload is under `data`.
      const result = await api.post<{ received: boolean; reference?: string }>(
        "/contact",
        payload
      );
      setReference(result.data?.reference ?? null);
      setStatus("sent");
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(err.fieldErrors ?? {});
      } else {
        setError("We could not send that just now. Please email us directly.");
      }
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <>
        <MarketingHeader />
        <main id="main" className="mx-auto max-w-2xl px-5 py-20 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-[var(--success,#16a34a)]" aria-hidden />
          <h1 className="mt-4 text-[26px] font-semibold tracking-tight text-[var(--text)]">
            Thank you — we have it
          </h1>
          <p className="mx-auto mt-3 max-w-md text-[14.5px] leading-relaxed text-[var(--text-muted)]">
            A person will reply, not an autoresponder. If it is urgent and you would rather not
            wait, write to{" "}
            <a
              href={`mailto:${COMPANY.email.support}`}
              className="font-medium text-brand-700 underline underline-offset-2"
            >
              {COMPANY.email.support}
            </a>
            .
          </p>
          {reference && (
            <p className="mt-4 text-[13px] text-[var(--text-subtle)]">
              Your reference is{" "}
              <span className="font-mono font-medium text-[var(--text)]">{reference}</span> — quote
              it if you follow up.
            </p>
          )}
          <Link
            href="/"
            className="mt-8 inline-flex h-10 items-center rounded-[calc(var(--radius)-2px)] border bg-[var(--surface)] px-5 text-[14px] font-medium text-[var(--text)] hover:bg-[var(--surface-muted)]"
          >
            Back to the site
          </Link>
        </main>
        <MarketingFooter />
      </>
    );
  }

  const inputClass =
    "mt-1 w-full rounded-lg border bg-[var(--surface)] px-3 py-2 text-[14px] text-[var(--text)] outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

  return (
    <>
      <MarketingHeader />

      <main id="main" className="mx-auto max-w-5xl px-5 py-14 lg:py-20">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div>
            <h1 className="text-[32px] font-semibold tracking-tight text-[var(--text)]">
              Talk to us
            </h1>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-[var(--text-muted)]">
              Questions about whether the platform fits how your organisation actually works are
              the ones worth asking before you buy. Ask them here.
            </p>

            <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
              {error && (
                <div
                  role="alert"
                  className="rounded-lg border border-[var(--danger-border,#fecaca)] bg-[var(--danger-bg,#fef2f2)] px-4 py-3 text-[13.5px] text-[var(--danger-text,#b91c1c)]"
                >
                  {error}
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="name" className="text-[13.5px] font-medium text-[var(--text)]">
                    Your name <span className="text-[var(--danger,#dc2626)]">*</span>
                  </label>
                  <input id="name" name="name" required autoComplete="name" className={inputClass} />
                  {fieldErrors.name && (
                    <p className="mt-1 text-[12.5px] text-[var(--danger,#dc2626)]">
                      {fieldErrors.name}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="email" className="text-[13.5px] font-medium text-[var(--text)]">
                    Work email <span className="text-[var(--danger,#dc2626)]">*</span>
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    className={inputClass}
                  />
                  {fieldErrors.email && (
                    <p className="mt-1 text-[12.5px] text-[var(--danger,#dc2626)]">
                      {fieldErrors.email}
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="company" className="text-[13.5px] font-medium text-[var(--text)]">
                    Organisation
                  </label>
                  <input
                    id="company"
                    name="company"
                    autoComplete="organization"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label
                    htmlFor="employeeCount"
                    className="text-[13.5px] font-medium text-[var(--text)]"
                  >
                    Roughly how many employees
                  </label>
                  <input
                    id="employeeCount"
                    name="employeeCount"
                    type="number"
                    min={0}
                    inputMode="numeric"
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="subject" className="text-[13.5px] font-medium text-[var(--text)]">
                  What is this about
                </label>
                <select id="subject" name="subject" defaultValue="sales" className={inputClass}>
                  {SUBJECTS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="message" className="text-[13.5px] font-medium text-[var(--text)]">
                  Your message <span className="text-[var(--danger,#dc2626)]">*</span>
                </label>
                <textarea
                  id="message"
                  name="message"
                  required
                  rows={6}
                  className={inputClass}
                  placeholder="Tell us what you are trying to do. The more specific, the more useful our reply."
                />
                {fieldErrors.message && (
                  <p className="mt-1 text-[12.5px] text-[var(--danger,#dc2626)]">
                    {fieldErrors.message}
                  </p>
                )}
              </div>

              {/* Honeypot. Hidden from people and from screen readers; bots
                  fill it in and the submission is dropped. */}
              <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
                <label htmlFor="website">Leave this field empty</label>
                <input id="website" name="website" tabIndex={-1} autoComplete="off" />
              </div>

              <label className="flex items-start gap-2.5 text-[13px] leading-relaxed text-[var(--text-muted)]">
                <input type="checkbox" name="consent" className="mt-0.5" />
                <span>
                  You may email me occasionally about {COMPANY.product}. Optional — we will reply
                  to this enquiry either way, and you can unsubscribe at any time.
                </span>
              </label>

              <p className="text-[12.5px] leading-relaxed text-[var(--text-subtle)]">
                We use what you send here only to answer you. See the{" "}
                <Link href="/legal/privacy" className="underline underline-offset-2">
                  privacy policy
                </Link>
                .
              </p>

              <button
                type="submit"
                disabled={status === "sending"}
                className="inline-flex h-10 items-center rounded-[calc(var(--radius)-2px)] bg-brand-600 px-5 text-[14px] font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
              >
                {status === "sending" ? "Sending…" : "Send message"}
              </button>
            </form>
          </div>

          <aside className="space-y-6">
            <div>
              <h2 className="flex items-center gap-2 text-[14px] font-semibold text-[var(--text)]">
                <Mail className="h-4 w-4 text-brand-600" aria-hidden />
                Direct
              </h2>
              <ul className="mt-2 space-y-1.5 text-[13.5px] text-[var(--text-muted)]">
                <li>
                  Sales —{" "}
                  <a href={`mailto:${COMPANY.email.sales}`} className="text-brand-700 hover:underline">
                    {COMPANY.email.sales}
                  </a>
                </li>
                <li>
                  Support —{" "}
                  <a
                    href={`mailto:${COMPANY.email.support}`}
                    className="text-brand-700 hover:underline"
                  >
                    {COMPANY.email.support}
                  </a>
                </li>
                <li>
                  Security —{" "}
                  <a
                    href={`mailto:${COMPANY.email.security}`}
                    className="text-brand-700 hover:underline"
                  >
                    {COMPANY.email.security}
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <h2 className="flex items-center gap-2 text-[14px] font-semibold text-[var(--text)]">
                <MapPin className="h-4 w-4 text-brand-600" aria-hidden />
                Registered office
              </h2>
              <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--text-muted)]">
                {COMPANY.legalName}
                <br />
                {formattedAddress()}
              </p>
            </div>

            <div>
              <h2 className="flex items-center gap-2 text-[14px] font-semibold text-[var(--text)]">
                <ShieldCheck className="h-4 w-4 text-brand-600" aria-hidden />
                Data requests
              </h2>
              <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--text-muted)]">
                If your employer holds your data in this platform, they control it — ask them
                first. Otherwise write to{" "}
                <a
                  href={`mailto:${COMPANY.email.privacy}`}
                  className="text-brand-700 hover:underline"
                >
                  {COMPANY.email.privacy}
                </a>
                .
              </p>
            </div>

            <p className="text-[13px] leading-relaxed text-[var(--text-subtle)]">
              Support hours: {COMPANY.supportHours}.
            </p>
          </aside>
        </div>
      </main>

      <MarketingFooter />
    </>
  );
}
