"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardHeader, DataTable, Badge, TableToolbar, FilterSelect } from "@/components/ui";
import type { Column } from "@/components/ui";
import type { Paged } from "@/lib/types";

interface Org {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan?: { code?: string; status?: string };
  employeeCount?: number;
  createdAt: string;
}

/**
 * Every organisation on the deployment.
 *
 * Read-only here on purpose. Suspending a customer or changing their plan is
 * done from the organisation's own page, where the consequences are stated —
 * not from a row action in a list, where a misplaced click affects a live
 * business.
 */
export default function PlatformOrganizationsPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading, error } = useQuery<Paged<Org>>({
    queryKey: ["platform", "organizations", { search, status, page }],
    queryFn: async () =>
      (
        await api.get<Paged<Org>>("/platform/organizations", {
          query: { search: search || undefined, status: status || undefined, page, limit: 25 },
        })
      ).data,
  });

  const columns: Column<Org>[] = [
    {
      key: "name",
      header: "Organisation",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-medium text-[var(--text)]">{row.name}</p>
          <p className="truncate font-mono text-[12px] text-[var(--text-muted)]">{row.slug}</p>
        </div>
      ),
    },
    {
      key: "plan",
      header: "Plan",
      render: (row) => <Badge tone="neutral">{row.plan?.code ?? "—"}</Badge>,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <Badge
          tone={
            row.status === "active" ? "success" : row.status === "suspended" ? "danger" : "warning"
          }
        >
          {row.status}
        </Badge>
      ),
    },
    {
      key: "employeeCount",
      header: "Employees",
      align: "right",
      render: (row) => row.employeeCount ?? "—",
    },
    {
      key: "createdAt",
      header: "Signed up",
      render: (row) => new Date(row.createdAt).toLocaleDateString(),
    },
  ];

  return (
    <>
      <header className="mb-6">
        <h1 className="text-[22px] font-semibold tracking-tight text-[var(--text)]">
          Organisations
        </h1>
        <p className="mt-1 text-[14px] text-[var(--text-muted)]">
          {data?.total ?? 0} on this deployment.
        </p>
      </header>

      <Card>
        <CardHeader title="All organisations" />
        <div className="mt-4">
          <TableToolbar
            search={search}
            onSearchChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="Search by name, workspace or email…"
            activeFilterCount={status ? 1 : 0}
            onClearFilters={() => {
              setStatus("");
              setPage(1);
            }}
            filters={
              <FilterSelect
                value={status}
                onChange={(value) => {
                  setStatus(value);
                  setPage(1);
                }}
                placeholder="Any status"
                options={[
                  { value: "active", label: "Active" },
                  { value: "trial", label: "Trial" },
                  { value: "suspended", label: "Suspended" },
                ]}
              />
            }
          />

          <DataTable
            rows={data?.items ?? []}
            columns={columns}
            loading={isLoading}
            error={error ? "Could not load organisations." : null}
            rowKey={(row) => row.id}
            emptyTitle="Nothing matched"
            emptyDescription="No organisation matches these filters."
          />
        </div>
      </Card>
    </>
  );
}
