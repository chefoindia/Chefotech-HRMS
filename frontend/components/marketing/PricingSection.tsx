"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { humanise } from "@/lib/format";

interface Plan {
  code: string;
  name: string;
  description: string;
  monthlyPricePerEmployee: number | null;
  minimumBillable: number | null;
  trialDays: number | null;
  limits: Record<string, number | boolean | null>;
  features: string[];
  isPopular: boolean;
}

/**
 * Pricing.
 *
 * Read from the API rather than hard-coded in the page, so changing a plan in
 * the platform admin updates the marketing site with it. If the API is
 * unreachable the section falls back to a static summary rather than
 * disappearing — a marketing page that renders a blank hole when the backend
 * is down is worse than a slightly stale one.
 */
export function PricingSection() {
  const { data: plans, isError } = useQuery({
    queryKey: ["public", "plans"],
    queryFn: async () => {
      const { data } = await api.get<Plan[]>("/public/plans");
      return data;
    },
    staleTime: 30 * 60_000,
    retry: 1,
  });

  return (
    <section id="pricing" className="border-t bg-[var(--surface-muted)]">
      <div className="mx-auto max-w-6xl px-5 py-20">
        <div className="max-w-2xl">
          <h2 className="text-3xl font-semibold tracking-tight text-[var(--text)]">
            Pricing that scales with your headcount
          </h2>
          <p className="mt-3 text-[16px] text-[var(--text-muted)]">
            Every plan includes the full setup experience, guided help and unlimited
            support. Start on the trial with everything unlocked and decide later.
          </p>
        </div>

        {isError || !plans ? (
          <div className="mt-10 rounded-[var(--radius)] border bg-[var(--surface)] p-6">
            <p className="text-[14px] text-[var(--text-muted)]">
              Plans start with a 14-day trial that has every module unlocked.{" "}
              <Link href="/register" className="font-medium text-brand-600 hover:underline">
                Create an account
              </Link>{" "}
              to see current pricing, or contact us for enterprise terms.
            </p>
          </div>
        ) : (
          <div className="mt-10 grid gap-5 lg:grid-cols-3 xl:grid-cols-5">
            {plans.map((plan) => (
              <div
                key={plan.code}
                className={cn(
                  "flex flex-col rounded-[var(--radius)] border bg-[var(--surface)] p-5",
                  plan.isPopular && "border-brand-400 shadow-md ring-1 ring-brand-200"
                )}
              >
                {plan.isPopular && (
                  <span className="mb-3 inline-flex w-fit rounded-full bg-brand-600 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
                    Most popular
                  </span>
                )}

                <h3 className="text-[16px] font-semibold text-[var(--text)]">{plan.name}</h3>
                <p className="mt-1 min-h-[2.5rem] text-[13px] leading-relaxed text-[var(--text-muted)]">
                  {plan.description}
                </p>

                <div className="mt-4">
                  {plan.monthlyPricePerEmployee === null ? (
                    <p className="text-[22px] font-semibold text-[var(--text)]">Talk to us</p>
                  ) : plan.monthlyPricePerEmployee === 0 ? (
                    <p className="text-[22px] font-semibold text-[var(--text)]">Free</p>
                  ) : (
                    <p className="flex items-baseline gap-1">
                      <span className="tabular text-[26px] font-semibold text-[var(--text)]">
                        ₹{plan.monthlyPricePerEmployee}
                      </span>
                      <span className="text-[13px] text-[var(--text-muted)]">
                        /employee/month
                      </span>
                    </p>
                  )}

                  <p className="mt-1 h-4 text-[12px] text-[var(--text-subtle)]">
                    {plan.trialDays
                      ? `${plan.trialDays}-day trial`
                      : plan.minimumBillable
                        ? `Minimum ${plan.minimumBillable} employees`
                        : ""}
                  </p>
                </div>

                <Link
                  href="/register"
                  className={cn(
                    "mt-4 inline-flex h-9 items-center justify-center rounded-[calc(var(--radius)-2px)] text-[14px] font-medium transition-colors",
                    plan.isPopular
                      ? "bg-brand-600 text-white hover:bg-brand-700"
                      : "border border-[var(--border-strong)] text-[var(--text)] hover:bg-[var(--surface-muted)]"
                  )}
                >
                  {plan.monthlyPricePerEmployee === null ? "Contact sales" : "Get started"}
                </Link>

                <ul className="mt-5 space-y-2 border-t pt-4">
                  <PlanLimit label="employees" value={plan.limits.employees} />
                  <PlanLimit label="administrators" value={plan.limits.admins} />
                  <PlanLimit label="biometric devices" value={plan.limits.biometricDevices} />

                  {plan.features.slice(0, 6).map((feature) => (
                    <li key={feature} className="flex gap-2">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--success)]" aria-hidden />
                      <span className="text-[12.5px] text-[var(--text-muted)]">
                        {humanise(feature)}
                      </span>
                    </li>
                  ))}

                  {plan.features.length > 6 && (
                    <li className="pl-5.5 text-[12.5px] text-[var(--text-subtle)]">
                      +{plan.features.length - 6} more
                    </li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function PlanLimit({ label, value }: { label: string; value: number | boolean | null }) {
  if (value === null || value === undefined) {
    return (
      <li className="flex gap-2">
        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--success)]" aria-hidden />
        <span className="text-[12.5px] text-[var(--text-muted)]">Unlimited {label}</span>
      </li>
    );
  }

  if (typeof value === "boolean") return null;

  return (
    <li className="flex gap-2">
      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--success)]" aria-hidden />
      <span className="text-[12.5px] text-[var(--text-muted)]">
        Up to <span className="tabular font-medium text-[var(--text)]">{value.toLocaleString()}</span>{" "}
        {label}
      </span>
    </li>
  );
}
