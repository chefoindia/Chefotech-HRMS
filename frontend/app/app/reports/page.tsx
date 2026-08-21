"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Download, Play } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useReferenceData, toOptions } from "@/lib/hooks";
import { formatDate, formatMoney, humanise, todayString } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Button,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  NoAccessState,
  PageHeader,
  Select,
  useToast,
  type Column,
} from "@/components/ui";

interface ReportDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  filters: string[];
  columns: Array<{ key: string; label: string; type?: string; width?: number }>;
  requiresDateRange: boolean;
  requiresRun: boolean;
}

type Row = Record<string, unknown>;

/**
 * Reports.
 *
 * The catalog, the filter form and the columns all come from the API's report
 * definitions, so adding a report on the server makes it appear here with the
 * right filters and no frontend change.
 */
export default function ReportsPage() {
  const { session, can } = useSession();
  const toast = useToast();
  const locale = session?.organization?.locale || "en-IN";
  const currency = session?.organization?.currency || "INR";
  const timezone = session?.organization?.timezone;

  const [selected, setSelected] = useState<ReportDefinition | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [ran, setRan] = useState(false);

  const reference = useReferenceData(can("report.view"));

  const { data: reports, isLoading: catalogLoading } = useQuery({
    queryKey: ["reports", "catalog"],
    queryFn: async () => {
      const { data } = await api.get<ReportDefinition[]>("/reports");
      return data;
    },
    enabled: can("report.view"),
  });

  const { data: result, isFetching } = useQuery({
    queryKey: ["reports", "run", selected?.id, filters],
    queryFn: async () => {
      const { data } = await api.get<{
        name: string;
        columns: ReportDefinition["columns"];
        rows: Row[];
        total: number;
        truncated: boolean;
      }>(`/reports/${selected!.id}/run`, { query: filters });
      return data;
    },
    enabled: Boolean(selected) && ran,
    retry: false,
  });

  const exportReport = async (format: "xlsx" | "csv") => {
    if (!selected) return;
    try {
      await api.download(`/reports/${selected.id}/run`, { ...filters, format }, `${selected.id}.${format}`);
      toast.success("Export started", "Your download should begin shortly.");
    } catch (error) {
      toast.fromError(error, "Could not export that report.");
    }
  };

  const openReport = (report: ReportDefinition) => {
    setSelected(report);
    setRan(false);
    const today = todayString(timezone);
    setFilters(
      report.requiresDateRange
        ? { fromDate: `${today.slice(0, 8)}01`, toDate: today }
        : {}
    );
  };

  if (!can("report.view")) return <NoAccessState what="reports" />;

  const grouped = groupBy(reports || [], (report) => report.category);

  const columns: Array<Column<Row>> = (result?.columns || []).map((column) => ({
    key: column.key,
    header: column.label,
    align: column.type === "money" || column.type === "number" ? "right" : "left",
    render: (row) => formatCell(row[column.key], column.type, { locale, currency }),
  }));

  return (
    <>
      <PageHeader
        title="Reports"
        description="Run a report, review it on screen, then export it to Excel or CSV."
      />

      <div className="lg:flex lg:gap-6">
        {/* ── Catalog ──────────────────────────────────────────────── */}
        <div className="mb-5 lg:mb-0 lg:w-72 lg:shrink-0">
          {catalogLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((index) => (
                <div key={index} className="skeleton h-14" />
              ))}
            </div>
          ) : (
            Object.entries(grouped).map(([category, categoryReports]) => (
              <div key={category} className="mb-4">
                <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-subtle)]">
                  {humanise(category)}
                </p>
                <div className="space-y-1">
                  {categoryReports.map((report) => (
                    <button
                      key={report.id}
                      type="button"
                      onClick={() => openReport(report)}
                      className={cn(
                        "w-full rounded-[var(--radius)] border p-3 text-left transition-colors",
                        selected?.id === report.id
                          ? "border-brand-300 bg-brand-50"
                          : "hover:bg-[var(--surface-muted)]"
                      )}
                    >
                      <p className="text-[13.5px] font-medium text-[var(--text)]">{report.name}</p>
                      <p className="mt-0.5 text-[12px] leading-snug text-[var(--text-muted)]">
                        {report.description}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* ── Runner ───────────────────────────────────────────────── */}
        <div className="min-w-0 flex-1">
          {!selected ? (
            <Card>
              <EmptyState
                icon={<BarChart3 className="h-6 w-6" />}
                title="Choose a report"
                description="Pick one from the list to set its filters and run it."
              />
            </Card>
          ) : (
            <>
              <Card className="mb-4">
                <CardHeader title={selected.name} description={selected.description} />

                <div className="mt-4 flex flex-wrap items-end gap-3">
                  {selected.filters.includes("fromDate") && (
                    <div>
                      <label className="block text-[12.5px] font-medium text-[var(--text)]">From</label>
                      <input
                        type="date"
                        value={filters.fromDate || ""}
                        onChange={(event) =>
                          setFilters({ ...filters, fromDate: event.target.value })
                        }
                        className="input-base mt-1 h-9 w-auto"
                      />
                    </div>
                  )}

                  {selected.filters.includes("toDate") && (
                    <div>
                      <label className="block text-[12.5px] font-medium text-[var(--text)]">To</label>
                      <input
                        type="date"
                        value={filters.toDate || ""}
                        onChange={(event) => setFilters({ ...filters, toDate: event.target.value })}
                        className="input-base mt-1 h-9 w-auto"
                      />
                    </div>
                  )}

                  {selected.filters.includes("departmentId") && (
                    <Select
                      label="Department"
                      value={filters.departmentId || ""}
                      onChange={(event) =>
                        setFilters({ ...filters, departmentId: event.target.value })
                      }
                      options={toOptions(reference.departments)}
                      placeholder="All departments"
                      className="h-9 w-auto py-0"
                    />
                  )}

                  {selected.filters.includes("locationId") && (
                    <Select
                      label="Location"
                      value={filters.locationId || ""}
                      onChange={(event) => setFilters({ ...filters, locationId: event.target.value })}
                      options={toOptions(reference.locations)}
                      placeholder="All locations"
                      className="h-9 w-auto py-0"
                    />
                  )}

                  <Button
                    className="ml-auto"
                    loading={isFetching}
                    onClick={() => setRan(true)}
                    icon={<Play className="h-4 w-4" />}
                  >
                    Run report
                  </Button>

                  {can("report.export") && result && (
                    <>
                      <Button
                        variant="outline"
                        onClick={() => exportReport("xlsx")}
                        icon={<Download className="h-4 w-4" />}
                      >
                        Excel
                      </Button>
                      <Button variant="outline" onClick={() => exportReport("csv")}>
                        CSV
                      </Button>
                    </>
                  )}
                </div>

                {selected.requiresRun && (
                  <p className="mt-3 text-[12.5px] text-[var(--text-muted)]">
                    This report needs a payroll run. Open Payroll, pick a run, and use the export
                    from there.
                  </p>
                )}
              </Card>

              {ran && (
                <DataTable
                  columns={columns}
                  rows={result?.rows || []}
                  rowKey={(_row, index) => String(index)}
                  loading={isFetching}
                  dense
                  emptyTitle="No rows"
                  emptyDescription="Nothing matched those filters."
                />
              )}

              {result?.truncated && (
                <p className="mt-2 text-[12.5px] text-[var(--warning)]">
                  Showing the first {result.rows.length} of {result.total.toLocaleString()} rows.
                  Export to see all of them.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function formatCell(
  value: unknown,
  type: string | undefined,
  { locale, currency }: { locale: string; currency: string }
) {
  if (value === null || value === undefined || value === "") return "—";
  if (type === "money") return formatMoney(Number(value), { locale, currency });
  if (type === "date") return formatDate(String(value), { locale });
  if (type === "number") return Number(value).toLocaleString(locale);
  return String(value);
}

function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((accumulator, item) => {
    const group = key(item);
    (accumulator[group] = accumulator[group] || []).push(item);
    return accumulator;
  }, {});
}
