"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Search, ShieldCheck, XCircle } from "lucide-react";
import { MarketingHeader, MarketingFooter } from "@/components/marketing/Chrome";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";

interface Verification {
  valid: boolean;
  code?: string;
  documentName?: string;
  documentNumber?: string | null;
  issuedOn?: string;
  issuedBy?: string | null;
  employeeCodeMasked?: string | null;
  fingerprint?: string | null;
}

/**
 * Public document verification.
 *
 * The QR on a generated letter lands here. It answers one question — was
 * this issued through the platform by that organization — and says nothing
 * about the person the document concerns beyond a masked employee code.
 */
export default function VerifyDocumentPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const router = useRouter();
  const [input, setInput] = useState("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["public", "verify", code],
    queryFn: async () => {
      const { data: result } = await api.get<Verification>(`/public/verify/${encodeURIComponent(code)}`, { raw: true });
      return result;
    },
    retry: false,
  });

  const check = (event: React.FormEvent) => {
    event.preventDefault();
    const clean = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (clean.length >= 6) router.push(`/verify/${clean}`);
  };

  return (
    <>
      <MarketingHeader />
      <main id="main" className="mx-auto max-w-2xl px-5 py-14 lg:py-20">
        <div className="flex items-center gap-2 text-[13px] font-medium uppercase tracking-wider text-[var(--text-subtle)]">
          <ShieldCheck className="h-4 w-4" aria-hidden />
          Document verification
        </div>
        <h1 className="mt-2 text-[28px] font-semibold tracking-tight text-[var(--text)]">
          Code <span className="font-mono">{code.toUpperCase()}</span>
        </h1>

        <div className="mt-8 rounded-xl border bg-[var(--surface)] p-6">
          {isLoading ? (
            <div className="flex items-center gap-3 text-[14px] text-[var(--text-muted)]">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-brand-600" />
              Checking…
            </div>
          ) : isError ? (
            <p className="text-[14px] text-[var(--text-muted)]">The verification service could not be reached. Please try again in a moment.</p>
          ) : data?.valid ? (
            <>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-[var(--success,#16a34a)]" aria-hidden />
                <div>
                  <p className="text-[16px] font-semibold text-[var(--text)]">This document is genuine</p>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-[var(--text-muted)]">
                    It was issued through ChefoTech HRMS and matches the copy on record. If the printed details differ from the ones below, the copy you hold has been altered.
                  </p>
                </div>
              </div>
              <dl className="mt-6 grid gap-x-6 gap-y-3 text-[13.5px] sm:grid-cols-2">
                <Row label="Document" value={data.documentName} />
                <Row label="Reference number" value={data.documentNumber || "—"} />
                <Row label="Issued by" value={data.issuedBy || "—"} />
                <Row label="Issued on" value={formatDate(data.issuedOn)} />
                <Row label="Employee code" value={data.employeeCodeMasked || "—"} />
                <Row label="Fingerprint" value={<span className="font-mono">{data.fingerprint || "—"}</span>} />
              </dl>
            </>
          ) : (
            <div className="flex items-start gap-3">
              <XCircle className="mt-0.5 h-6 w-6 shrink-0 text-[var(--danger,#dc2626)]" aria-hidden />
              <div>
                <p className="text-[16px] font-semibold text-[var(--text)]">No document matches this code</p>
                <p className="mt-1 text-[13.5px] leading-relaxed text-[var(--text-muted)]">
                  Check the code for typing mistakes — it never contains the letters O or I, or the digits 0 or 1. If it still does not match, the document was not issued through this platform, or it has been withdrawn.
                </p>
              </div>
            </div>
          )}
        </div>

        <form onSubmit={check} className="mt-8 flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-subtle)]" aria-hidden />
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Check another code" className="input-base h-11 pl-9 font-mono uppercase" aria-label="Verification code" />
          </div>
          <button type="submit" className="h-11 rounded-[var(--radius)] bg-brand-600 px-4 text-[14px] font-medium text-white hover:bg-brand-700">
            Verify
          </button>
        </form>

        <p className="mt-6 text-[12.5px] text-[var(--text-subtle)]">
          Verification reveals only that a document exists and was not altered. No personal details are shown, and each check is counted so the issuing organization can see unusual activity.
        </p>
      </main>
      <MarketingFooter />
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11.5px] font-medium uppercase tracking-wider text-[var(--text-subtle)]">{label}</dt>
      <dd className="mt-0.5 text-[var(--text)]">{value}</dd>
    </div>
  );
}
