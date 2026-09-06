"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, Check, Download, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatBytes } from "@/lib/files";
import { formatDate, formatDateTime, humanise } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  NoAccessState,
  PageLoader,
  useToast,
} from "@/components/ui";

interface ExportFile {
  id: string;
  fileName: string;
  size: number;
  createdAt: string;
  collections?: Record<string, number | string>;
}

/**
 * Take everything with you: a zip of every collection as JSON, produced in
 * the background and kept for ten days. The answer to the procurement
 * question "can we get our data out", and the safety net a customer wants
 * before a big import.
 */
function DataExportCard({ locale }: { locale: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["organization", "exports"],
    queryFn: async () => {
      const { data: files } = await api.get<ExportFile[]>("/organizations/current/exports");
      return files;
    },
    refetchInterval: (query) => (query.state.data && query.state.data.length === 0 ? 5000 : false),
  });

  const request = useMutation({
    mutationFn: async () => api.post("/organizations/current/exports"),
    onSuccess: () => {
      toast.success("Export started", "You will be notified when the file is ready. It usually takes under a minute.");
      queryClient.invalidateQueries({ queryKey: ["organization", "exports"] });
    },
    onError: (error) => toast.fromError(error, "Could not start an export."),
  });

  return (
    <Card>
      <CardHeader
        title="Data export"
        description="Everything in this organization as a zip of JSON files, one per collection, with a manifest. Credentials and secrets are never included."
        action={
          <Button icon={<Archive className="h-4 w-4" />} loading={request.isPending} onClick={() => request.mutate()}>
            Prepare export
          </Button>
        }
      />
      <div className="mt-4">
        {isLoading ? (
          <p className="text-[13px] text-[var(--text-muted)]">Loading…</p>
        ) : !data || data.length === 0 ? (
          <p className="text-[13px] text-[var(--text-muted)]">No exports yet. Prepare one and download it from here once it is ready.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
            {data.map((file) => {
              const counts = Object.values(file.collections || {}).filter((v): v is number => typeof v === "number");
              const records = counts.reduce((a, b) => a + b, 0);
              return (
                <li key={file.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div>
                    <p className="text-[13.5px] font-medium text-[var(--text)]">{file.fileName}</p>
                    <p className="text-[12.5px] text-[var(--text-muted)]">
                      {formatDateTime(file.createdAt, { locale })} · {formatBytes(file.size)} · {counts.length} collections · {records.toLocaleString(locale)} records
                    </p>
                  </div>
                  <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={() => api.download(`/files/${file.id}/content`, { download: 1 }, file.fileName).catch((error) => toast.fromError(error, "Could not download the export."))}>
                    Download
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}

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

      {can("settings.manage") && <DataExportCard locale={locale} />}
    </div>
  );
}
