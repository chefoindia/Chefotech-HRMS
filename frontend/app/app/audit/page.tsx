"use client";

import { useQuery } from "@tanstack/react-query";
import { Download, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useListQuery, useListState } from "@/lib/hooks";
import { formatDateTime, humanise } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Badge,
  Button,
  DataTable,
  FilterSelect,
  NoAccessState,
  PageHeader,
  TableToolbar,
  useToast,
  type Column,
} from "@/components/ui";

interface AuditEntry {
  _id: string;
  action: string;
  entityType: string;
  entityLabel: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorType: string;
  severity: "info" | "notice" | "warning" | "critical";
  description: string | null;
  changedFields: string[];
  ip: string | null;
  occurredAt: string;
}

const SEVERITY_TONES = {
  info: "neutral",
  notice: "info",
  warning: "warning",
  critical: "danger",
} as const;

export default function AuditPage() {
  const { session, can } = useSession();
  const toast = useToast();
  const locale = session?.organization?.locale || "en-IN";
  const timezone = session?.organization?.timezone;

  const state = useListState();

  const { data: actions } = useQuery({
    queryKey: ["audit", "actions"],
    queryFn: async () => {
      const { data } = await api.get<string[]>("/audit/actions");
      return data;
    },
    enabled: can("audit.view"),
    staleTime: 10 * 60_000,
  });

  const { items, total, limit, isLoading, error, refetch } = useListQuery<AuditEntry>(
    "audit",
    "/audit",
    state,
    { limit: 50, enabled: can("audit.view") }
  );

  if (!can("audit.view")) return <NoAccessState what="the audit trail" />;

  const exportTrail = async () => {
    const today = new Date().toISOString().slice(0, 10);
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    try {
      await api.download("/audit/export", {
        fromDate: state.filters.fromDate || ninetyDaysAgo,
        toDate: state.filters.toDate || today,
        ...state.filters,
      });
      toast.success("Export started");
    } catch (err) {
      toast.fromError(err, "Could not export the audit trail.");
    }
  };

  const columns: Array<Column<AuditEntry>> = [
    {
      key: "occurredAt",
      header: "When",
      width: "180px",
      render: (row) => (
        <span className="text-[12.5px] text-[var(--text-muted)]">
          {formatDateTime(row.occurredAt, { locale, timezone })}
        </span>
      ),
    },
    {
      key: "action",
      header: "Action",
      render: (row) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge tone={SEVERITY_TONES[row.severity]}>{humanise(row.action.split(".").pop() || "")}</Badge>
            <span className="truncate font-mono text-[11.5px] text-[var(--text-subtle)]">
              {row.action}
            </span>
          </div>
          {row.description && (
            <p className="mt-0.5 truncate text-[12.5px] text-[var(--text-muted)]">
              {row.description}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "entity",
      header: "Subject",
      hideBelow: "md",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[13px] text-[var(--text)]">{row.entityLabel || "—"}</p>
          <p className="text-[11.5px] text-[var(--text-subtle)]">{row.entityType}</p>
        </div>
      ),
    },
    {
      key: "actor",
      header: "By",
      hideBelow: "sm",
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate text-[13px] text-[var(--text)]">
            {row.actorName || row.actorEmail || humanise(row.actorType)}
          </p>
          {row.ip && <p className="text-[11.5px] text-[var(--text-subtle)]">{row.ip}</p>}
        </div>
      ),
    },
    {
      key: "changedFields",
      header: "Changed",
      hideBelow: "lg",
      render: (row) =>
        row.changedFields.length ? (
          <span className="text-[12px] text-[var(--text-muted)]">
            {row.changedFields.slice(0, 3).join(", ")}
            {row.changedFields.length > 3 && ` +${row.changedFields.length - 3}`}
          </span>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Audit trail"
        description="Every sensitive change, who made it and what it was before. Entries cannot be edited or deleted."
        actions={
          can("audit.export") && (
            <Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={exportTrail}>
              Export
            </Button>
          )
        }
      />

      <DataTable
        columns={columns}
        rows={items}
        rowKey={(row) => row._id}
        loading={isLoading}
        error={error ? (error as Error).message : null}
        onRetry={refetch}
        page={state.page}
        limit={limit}
        total={total}
        onPageChange={state.setPage}
        dense
        emptyIcon={<ShieldCheck className="h-6 w-6" />}
        emptyTitle="Nothing recorded yet"
        emptyDescription="Salary changes, approvals, policy edits and locks all appear here."
        toolbar={
          <TableToolbar
            activeFilterCount={state.activeFilterCount}
            onClearFilters={state.clearFilters}
            filters={
              <>
                <FilterSelect
                  value={state.filters.severity || ""}
                  onChange={(value) => state.setFilter("severity", value)}
                  options={["critical", "warning", "notice", "info"].map((value) => ({
                    value,
                    label: humanise(value),
                  }))}
                  placeholder="Any severity"
                />
                <FilterSelect
                  value={state.filters.action || ""}
                  onChange={(value) => state.setFilter("action", value)}
                  options={(actions || []).map((action) => ({ value: action, label: action }))}
                  placeholder="Any action"
                />
                <input
                  type="date"
                  value={state.filters.fromDate || ""}
                  onChange={(event) => state.setFilter("fromDate", event.target.value)}
                  aria-label="From date"
                  className={cn(
                    "input-base h-9 w-auto py-0 text-[13px]",
                    state.filters.fromDate && "border-brand-400 bg-brand-50"
                  )}
                />
                <input
                  type="date"
                  value={state.filters.toDate || ""}
                  onChange={(event) => state.setFilter("toDate", event.target.value)}
                  aria-label="To date"
                  className={cn(
                    "input-base h-9 w-auto py-0 text-[13px]",
                    state.filters.toDate && "border-brand-400 bg-brand-50"
                  )}
                />
              </>
            }
          />
        }
      />
    </>
  );
}
