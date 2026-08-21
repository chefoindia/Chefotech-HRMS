"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, Circle, X } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui";
import type { OnboardingProgress, OnboardingStep } from "@/lib/types";

/**
 * Setup progress.
 *
 * Shown until the required steps are done. It is a nudge, not a wall — the
 * product is fully usable from the first minute, and a company that does not
 * run payroll through us should not be stuck at 80% forever. Only required
 * steps count toward the percentage.
 */
export function OnboardingBanner() {
  const { session, can } = useSession();
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const { data } = useQuery({
    queryKey: ["onboarding"],
    queryFn: async () => {
      const { data: payload } = await api.get<{
        steps: OnboardingStep[];
        progress: OnboardingProgress;
        dismissed: boolean;
      }>("/organizations/current/onboarding");
      return payload;
    },
    enabled: Boolean(session) && can("settings.view"),
    staleTime: 60_000,
  });

  if (!data || data.progress.isComplete || dismissed) return null;

  const { progress, steps } = data;
  const remaining = steps.filter(
    (step) => step.required && step.status !== "completed" && step.status !== "skipped"
  );

  return (
    <div className="mb-5 overflow-hidden rounded-[var(--radius)] border border-brand-200 bg-gradient-to-r from-brand-50 to-[var(--surface)]">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-[14px] font-semibold text-[var(--text)]">Finish setting up</h2>
            <span className="tabular text-[13px] font-semibold text-brand-700">
              {progress.percent}%
            </span>
          </div>

          <div className="mt-2 h-1.5 w-full max-w-md overflow-hidden rounded-full bg-brand-100">
            <div
              className="h-full rounded-full bg-brand-600 transition-all duration-500"
              style={{ width: `${progress.percent}%` }}
            />
          </div>

          <p className="mt-1.5 text-[12.5px] text-[var(--text-muted)]">
            {progress.completedCount} of {progress.requiredCount} essential steps done
            {progress.nextStep && ` · next: ${progress.nextStep.title}`}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "Hide" : "Show steps"}
          </Button>

          {progress.nextStep && (
            <Link href={progress.nextStep.route}>
              <Button size="sm" iconRight={<ArrowRight className="h-3.5 w-3.5" />}>
                Continue
              </Button>
            </Link>
          )}

          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Hide setup for now"
            className="rounded p-1.5 text-[var(--text-subtle)] hover:bg-white/60"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="grid gap-1 border-t border-brand-100 bg-[var(--surface)]/70 p-3 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((step) => {
            const done = step.status === "completed" || step.status === "skipped";
            return (
              <Link
                key={step.key}
                href={step.route}
                className={cn(
                  "flex items-start gap-2.5 rounded-md p-2.5 hover:bg-brand-50",
                  done && "opacity-60"
                )}
              >
                {done ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--success)]" aria-hidden />
                ) : (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-subtle)]" aria-hidden />
                )}
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-[var(--text)]">
                    {step.title}
                    {!step.required && (
                      <span className="ml-1.5 text-[11px] font-normal text-[var(--text-subtle)]">
                        optional
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-[12px] text-[var(--text-muted)]">
                    {step.description}
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
