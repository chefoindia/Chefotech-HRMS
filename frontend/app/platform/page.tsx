"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Building2, Users, UserCheck, AlertTriangle, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api";
import { Card, CardHeader, StatCard, DataTable, Badge } from "@/components/ui";
import type { Column } from "@/components/ui";

interface Overview {
  organizations: number;
  users: number;
  employees: number;
  byStatus: Record<string, number>;
  byPlan: Record<string, number>;
  recentSignups: {
    _id: string;
    name: string;
    slug: string;
    status: string;
    plan?: { code?: string };
    createdAt: string;
  }[];
}

interface PlatformHealth {
  status?: string;
  checks?: Record<string, { ok: boolean; detail?: string }>;
  [key: string]: unknown;
}

export default function PlatformOverviewPage() {
  const { data, isLoading } = useQuery<Overview>({
    queryKey: ["platform", "overview"],
    queryFn: async () => (await api.get<Overview>("/platform/overview")).data,
    refetchInterval: 60_000,
  });

  const { data: health } = useQuery<PlatformHealth>({
    queryKey: ["platform", "health"],
    queryFn: async () => (await api.get<PlatformHealth>("/platform/health")).data,
    refetchInterval: 60_000,
  });

  const columns: Column<Overview["recentSignups"][number]>[] = [
    {
      key: "name",
      header: "Organisation",
      render: (row) => (
        <Link
          href={`/platform/organizations/${row._id}`}
          className="font-medium text-brand-700 hover:underline"
        >
          {row.name}
        </Link>
      ),
    },
    { key: "slug", header: "Workspace", render: (row) => <span className="font-mono text-[12.5px]">{row.slug}</span> },
    {
      key: "plan",
      header: "Plan",
      render: (row) => <Badge tone="neutral">{row.plan?.code ?? "—"}</Badge>,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <Badge tone={row.status === "active" ? "success" : row.status === "suspended" ? "danger" : "warning"}>
          {row.status}
        </Badge>
      ),
    },
    {
      key: "createdAt",
      header: "Signed up",
      render: (row) => new Date(row.createdAt).toLocaleDateString(),
    },
  ];

  const unhealthy = health?.checks
    ? Object.entries(health.checks).filter(([, check]) => !check.ok)
    : [];

  return (
    <>
      <header className="mb-6">
        <h1 className="text-[22px] font-semibold tracking-tight text-[var(--text)]">
          Platform overview
        </h1>
        <p className="mt-1 text-[14px] text-[var(--text-muted)]">
          Every organisation on this deployment.
        </p>
      </header>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Organisations"
          value={isLoading ? "—" : String(data?.organizations ?? 0)}
          icon={<Building2 className="h-4 w-4" />}
        />
        <StatCard
          label="Users"
          value={isLoading ? "—" : String(data?.users ?? 0)}
          icon={<Users className="h-4 w-4" />}
        />
        <StatCard
          label="Employee records"
          value={isLoading ? "—" : String(data?.employees ?? 0)}
          icon={<UserCheck className="h-4 w-4" />}
        />
      </div>

      {health && (
        <Card className="mb-6">
          <CardHeader
            title="System health"
            description="Reported by the API for this deployment."
          />
          <div className="mt-3 flex items-start gap-3">
            {unhealthy.length === 0 ? (
              <>
                <CheckCircle2
                  className="mt-0.5 h-4 w-4 shrink-0 text-[var(--success,#16a34a)]"
                  aria-hidden
                />
                <p className="text-[13.5px] text-[var(--text-muted)]">
                  Everything the API depends on is responding.
                </p>
              </>
            ) : (
              <>
                <AlertTriangle
                  className="mt-0.5 h-4 w-4 shrink-0 text-[var(--danger,#dc2626)]"
                  aria-hidden
                />
                <div className="text-[13.5px] text-[var(--text-muted)]">
                  <p className="font-medium text-[var(--text)]">
                    {unhealthy.length} component{unhealthy.length === 1 ? "" : "s"} unhealthy
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {unhealthy.map(([name, check]) => (
                      <li key={name}>
                        {name} — {check.detail || "unavailable"}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </div>
        </Card>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader title="By status" />
          <ul className="mt-3 space-y-1.5">
            {Object.entries(data?.byStatus ?? {}).map(([status, count]) => (
              <li key={status} className="flex items-center justify-between text-[13.5px]">
                <span className="text-[var(--text-muted)]">{status}</span>
                <span className="font-medium tabular-nums text-[var(--text)]">{count}</span>
              </li>
            ))}
            {!isLoading && !Object.keys(data?.byStatus ?? {}).length && (
              <li className="text-[13.5px] text-[var(--text-subtle)]">No organisations yet.</li>
            )}
          </ul>
        </Card>

        <Card>
          <CardHeader title="By plan" />
          <ul className="mt-3 space-y-1.5">
            {Object.entries(data?.byPlan ?? {}).map(([plan, count]) => (
              <li key={plan} className="flex items-center justify-between text-[13.5px]">
                <span className="text-[var(--text-muted)]">{plan}</span>
                <span className="font-medium tabular-nums text-[var(--text)]">{count}</span>
              </li>
            ))}
            {!isLoading && !Object.keys(data?.byPlan ?? {}).length && (
              <li className="text-[13.5px] text-[var(--text-subtle)]">No plans in use yet.</li>
            )}
          </ul>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Recent sign-ups"
          description="The ten most recent organisations."
          action={
            <Link
              href="/platform/organizations"
              className="text-[13px] font-medium text-brand-700 hover:underline"
            >
              View all
            </Link>
          }
        />
        <div className="mt-4">
          <DataTable
            rows={data?.recentSignups ?? []}
            columns={columns}
            loading={isLoading}
            rowKey={(row) => row._id}
            emptyTitle="No organisations yet"
            emptyDescription="Nobody has signed up on this deployment."
          />
        </div>
      </Card>
    </>
  );
}
