"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardHeader, DataTable, Badge, FilterSelect, TableToolbar } from "@/components/ui";
import type { Column } from "@/components/ui";
import type { Paged } from "@/lib/types";

interface AuditEntry {
  _id: string;
  action: string;
  severity?: string;
  organizationId?: string;
  actorEmail?: string;
  actorName?: string;
  entityType?: string;
  ipAddress?: string;
  occurredAt: string;
}

/**
 * Platform-wide audit.
 *
 * Spans every organisation, which is why the API restricts it to SUPER_ADMIN
 * rather than to anyone holding a platform login — a support role that can
 * read every tenant's security events is a far bigger grant than it looks.
 */
export default function PlatformAuditPage() {
  const [severity, setSeverity] = useState("");
  const [action, setAction] = useState("");

  const { data, isLoading, error } = useQuery<Paged<AuditEntry>>({
    queryKey: ["platform", "audit", { severity, action }],
    queryFn: async () =>
      (
        await api.get<Paged<AuditEntry>>("/platform/audit", {
          query: { severity: severity || undefined, action: action || undefined, limit: 50 },
        })
      ).data,
  });

  const columns: Column<AuditEntry>[] = [
    {
      key: "occurredAt",
      header: "When",
      render: (row) => new Date(row.occurredAt).toLocaleString(),
    },
    {
      key: "action",
      header: "Action",
      render: (row) => <span className="font-mono text-[12.5px]">{row.action}</span>,
    },
    {
      key: "severity",
      header: "Severity",
      render: (row) => (
        <Badge
          tone={
            row.severity === "critical"
              ? "danger"
              : row.severity === "warning"
                ? "warning"
                : "neutral"
          }
        >
          {row.severity ?? "info"}
        </Badge>
      ),
    },
    {
      key: "actor",
      header: "Actor",
      render: (row) => (
        <span className="text-[13px]">{row.actorName || row.actorEmail || "system"}</span>
      ),
    },
    {
      key: "organizationId",
      header: "Organisation",
      render: (row) =>
        row.organizationId ? (
          <span className="font-mono text-[12px] text-[var(--text-muted)]">
            {String(row.organizationId).slice(-8)}
          </span>
        ) : (
          <span className="text-[var(--text-subtle)]">platform</span>
        ),
    },
    {
      key: "ipAddress",
      header: "Source",
      render: (row) => (
        <span className="font-mono text-[12px] text-[var(--text-muted)]">
          {row.ipAddress || "—"}
        </span>
      ),
    },
  ];

  return (
    <>
      <header className="mb-6">
        <h1 className="text-[22px] font-semibold tracking-tight text-[var(--text)]">
          Platform audit
        </h1>
        <p className="mt-1 text-[14px] text-[var(--text-muted)]">
          Security-relevant events across every organisation. Append-only.
        </p>
      </header>

      <Card>
        <CardHeader title="Events" />
        <div className="mt-4">
          <TableToolbar
            search={action}
            onSearchChange={setAction}
            placeholder="Filter by action, e.g. auth.login_failed…"
            activeFilterCount={severity ? 1 : 0}
            onClearFilters={() => setSeverity("")}
            filters={
              <FilterSelect
                value={severity}
                onChange={setSeverity}
                placeholder="Any severity"
                options={[
                  { value: "info", label: "Info" },
                  { value: "warning", label: "Warning" },
                  { value: "critical", label: "Critical" },
                ]}
              />
            }
          />
          <DataTable
            rows={data?.items ?? []}
            columns={columns}
            loading={isLoading}
            error={error ? "Could not load the audit log." : null}
            rowKey={(row) => row._id}
            emptyTitle="No matching events"
            emptyDescription="Nothing in the audit log matches these filters."
          />
        </div>
      </Card>
    </>
  );
}
