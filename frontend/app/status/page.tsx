"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { MarketingHeader, MarketingFooter } from "@/components/marketing/Chrome";
import { COMPANY } from "@/content/company";
import { BASE_URL } from "@/lib/api";

/**
 * System status.
 *
 * Reads the API's readiness probe live. A status page that renders a
 * hard-coded "all systems operational" is worse than having none — it is
 * confidently wrong at exactly the moment someone checks it, which is during
 * an outage.
 *
 * If the request itself fails, that is reported as an outage rather than
 * swallowed, because a status page that cannot reach the API has learned
 * something important.
 */

interface Health {
  status: string;
  version?: string;
  uptimeSeconds?: number;
  checkedAt?: string;
  checks?: Record<string, { ok: boolean; detail?: string; latencyMs?: number }>;
}

const COMPONENT_LABELS: Record<string, string> = {
  database: "Database",
  storage: "File storage",
};

function Indicator({ ok, unknown }: { ok: boolean; unknown?: boolean }) {
  if (unknown)
    return <AlertTriangle className="h-4 w-4 text-[var(--warning,#d97706)]" aria-hidden />;
  return ok ? (
    <CheckCircle2 className="h-4 w-4 text-[var(--success,#16a34a)]" aria-hidden />
  ) : (
    <XCircle className="h-4 w-4 text-[var(--danger,#dc2626)]" aria-hidden />
  );
}

export default function StatusPage() {
  const { data, isLoading, isError, dataUpdatedAt } = useQuery<Health>({
    queryKey: ["system-status"],
    queryFn: async () => {
      const response = await fetch(`${BASE_URL}/health/ready`, { cache: "no-store" });
      // 503 is a valid, meaningful answer here — parse it rather than throwing.
      const body = await response.json().catch(() => null);
      if (!body?.data) throw new Error("unreachable");
      return body.data as Health;
    },
    refetchInterval: 30_000,
    retry: 1,
    staleTime: 0,
  });

  const allOk = data?.status === "ok";
  const unreachable = isError;

  return (
    <>
      <MarketingHeader />

      <main id="main" className="mx-auto max-w-3xl px-5 py-14 lg:py-20">
        <h1 className="text-[30px] font-semibold tracking-tight text-[var(--text)]">
          System status
        </h1>
        <p className="mt-2 text-[14.5px] text-[var(--text-muted)]">
          Checked live against the API, and refreshed every 30 seconds.
        </p>

        <div
          className={
            "mt-8 flex items-start gap-3 rounded-xl border p-5 " +
            (isLoading
              ? "bg-[var(--surface-muted)]"
              : unreachable || !allOk
                ? "border-[var(--danger-border,#fecaca)] bg-[var(--danger-bg,#fef2f2)]"
                : "border-[var(--success-border,#bbf7d0)] bg-[var(--success-bg,#f0fdf4)]")
          }
        >
          {isLoading ? (
            <span className="mt-0.5 h-4 w-4 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-brand-600" />
          ) : (
            <div className="mt-0.5">
              <Indicator ok={allOk && !unreachable} />
            </div>
          )}
          <div>
            <p className="text-[15px] font-semibold text-[var(--text)]">
              {isLoading
                ? "Checking…"
                : unreachable
                  ? "The API is not reachable from this page"
                  : allOk
                    ? "All systems operational"
                    : "Degraded — one or more components are unhealthy"}
            </p>
            <p className="mt-1 text-[13.5px] leading-relaxed text-[var(--text-muted)]">
              {unreachable
                ? "This may be an outage, or this page may be blocked from reaching the API by a network in between. If you are seeing problems, please tell us."
                : allOk
                  ? "The API is responding and every dependency it needs is healthy."
                  : "The service is up but something it depends on is not. Details below."}
            </p>
          </div>
        </div>

        {data?.checks && (
          <section className="mt-8">
            <h2 className="text-[13px] font-semibold uppercase tracking-wider text-[var(--text-subtle)]">
              Components
            </h2>
            <ul className="mt-3 divide-y rounded-xl border bg-[var(--surface)]">
              {Object.entries(data.checks).map(([key, check]) => (
                <li key={key} className="flex items-center gap-3 px-5 py-3.5">
                  <Indicator ok={check.ok} />
                  <span className="flex-1 text-[14px] font-medium text-[var(--text)]">
                    {COMPONENT_LABELS[key] ?? key}
                  </span>
                  <span className="text-[13px] text-[var(--text-muted)]">
                    {check.ok ? "Operational" : check.detail || "Unavailable"}
                    {typeof check.latencyMs === "number" && (
                      <span className="ml-2 tabular-nums text-[var(--text-subtle)]">
                        {check.latencyMs}ms
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <dl className="mt-8 grid gap-4 text-[13.5px] sm:grid-cols-3">
          <div>
            <dt className="text-[var(--text-subtle)]">API version</dt>
            <dd className="mt-0.5 font-medium text-[var(--text)]">{data?.version ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[var(--text-subtle)]">Uptime</dt>
            <dd className="mt-0.5 font-medium text-[var(--text)]">
              {typeof data?.uptimeSeconds === "number"
                ? `${Math.floor(data.uptimeSeconds / 3600)}h ${Math.floor((data.uptimeSeconds % 3600) / 60)}m`
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--text-subtle)]">Last checked</dt>
            <dd className="mt-0.5 font-medium text-[var(--text)]">
              {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : "—"}
            </dd>
          </div>
        </dl>

        <section className="mt-10 rounded-xl border bg-[var(--surface-muted)] p-5">
          <h2 className="text-[14.5px] font-semibold text-[var(--text)]">
            Seeing something we are not?
          </h2>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--text-muted)]">
            This page reports what the API can see about itself. It will not catch a problem
            that only affects one region, one browser or one account. If something is wrong for
            you, write to{" "}
            <a
              href={`mailto:${COMPANY.email.support}`}
              className="font-medium text-brand-700 underline underline-offset-2"
            >
              {COMPANY.email.support}
            </a>{" "}
            and we will look.
          </p>
          <p className="mt-3 text-[13.5px] text-[var(--text-muted)]">
            Availability commitments and service credits are in the{" "}
            <Link href="/legal/sla" className="text-brand-700 underline underline-offset-2">
              service level agreement
            </Link>
            .
          </p>
        </section>
      </main>

      <MarketingFooter />
    </>
  );
}
