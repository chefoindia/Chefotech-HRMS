"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatDate, humanise } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Badge,
  Callout,
  Card,
  CardHeader,
  NoAccessState,
  PageLoader,
} from "@/components/ui";

interface Usage {
  plan: {
    code: string;
    name: string;
    trialEndsAt: string | null;
    limits: Record<string, number | boolean>;
    features: string[];
  };
  usage: { employees: number; admins: number; biometricDevices: number; storageMb: number };
  remaining: Record<string, number>;
}

const LIMIT_LABELS: Record<string, string> = {
  employees: "Employees",
  admins: "Administrators",
  biometricDevices: "Biometric devices",
  storageMb: "Storage",
};

export default function PlanSettingsPage() {
  const { session, can } = useSession();
  const locale = session?.organization?.locale || "en-IN";

  const { data, isLoading } = useQuery({
    queryKey: ["organization", "usage"],
    queryFn: async () => {
      const { data: payload } = await api.get<Usage>("/organizations/current/usage");
      return payload;
    },
    enabled: can("settings.view"),
  });

  if (!can("settings.view")) return <NoAccessState what="plan and usage" />;
  if (isLoading || !data) return <PageLoader label="Loading your plan" />;

  const trialDaysLeft = data.plan.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(data.plan.trialEndsAt).getTime() - Date.now()) / 86400000))
    : null;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title={data.plan.name}
          description="What your organization is entitled to right now."
          action={<Badge tone="brand">{humanise(data.plan.code)}</Badge>}
        />

        {trialDaysLeft !== null && (
          <Callout
            tone={trialDaysLeft <= 3 ? "warning" : "info"}
            className="mt-4"
            icon={<Sparkles className="h-4 w-4" />}
          >
            {trialDaysLeft === 0 ? (
              <>Your trial has ended. Contact us to keep everything switched on.</>
            ) : (
              <>
                {trialDaysLeft} {trialDaysLeft === 1 ? "day" : "days"} left in your trial — every
                module is unlocked until{" "}
                {formatDate(data.plan.trialEndsAt!, { locale })}.
              </>
            )}
          </Callout>
        )}

        <div className="mt-5 space-y-4">
          {Object.entries(LIMIT_LABELS).map(([key, label]) => {
            const limit = data.plan.limits[key];
            const used = data.usage[key as keyof Usage["usage"]] || 0;
            const unlimited = typeof limit !== "number" || limit > 1_000_000;
            const percent = unlimited ? 0 : Math.min(100, Math.round((used / (limit as number)) * 100));

            return (
              <div key={key}>
                <div className="flex items-baseline justify-between">
                  <span className="text-[13.5px] font-medium text-[var(--text)]">{label}</span>
                  <span className="tabular text-[13px] text-[var(--text-muted)]">
                    {used.toLocaleString()}
                    {unlimited ? " · unlimited" : ` of ${(limit as number).toLocaleString()}`}
                    {key === "storageMb" && " MB"}
                  </span>
                </div>

                {!unlimited && (
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        percent >= 90
                          ? "bg-[var(--danger)]"
                          : percent >= 70
                            ? "bg-[var(--warning)]"
                            : "bg-brand-600"
                      )}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                )}

                {!unlimited && percent >= 90 && (
                  <p className="mt-1 text-[12px] text-[var(--danger)]">
                    Almost at the limit. Adding more will be blocked until you upgrade.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="What is included"
          description="Modules your plan has switched on."
        />

        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(session?.organization?.features || []).map((feature) => (
            <div key={feature} className="flex items-center gap-2">
              <Check className="h-4 w-4 shrink-0 text-[var(--success)]" aria-hidden />
              <span className="text-[13px] text-[var(--text)]">{humanise(feature)}</span>
            </div>
          ))}
        </div>

        <p className="mt-5 text-[13px] text-[var(--text-muted)]">
          Need something that is not here? Plans and per-organization overrides are managed by
          Chefotech — get in touch and we can switch a single module on without moving you to a
          different plan.
        </p>
      </Card>
    </div>
  );
}
