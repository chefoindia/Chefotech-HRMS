"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useReferenceData } from "@/lib/hooks";
import { Checkbox, FieldGrid, Input, Select } from "@/components/ui";
import type { SheetFilterKey, SheetFilters } from "@/lib/documentTemplateTypes";

/**
 * The filter inputs a sheet's data source declares — a date range for
 * attendance, a payroll run for the salary register, a department for any
 * of them. One component, driven by the source's `filters` list, so a new
 * source gets a working filter bar without a new form.
 */
export function SheetFilterFields({
  keys,
  value,
  onChange,
  requiresDateRange,
  requiresRun,
  columns = 3,
}: {
  keys: SheetFilterKey[];
  value: SheetFilters;
  onChange: (next: SheetFilters) => void;
  requiresDateRange?: boolean;
  requiresRun?: boolean;
  columns?: 2 | 3;
}) {
  const { departments, locations, designations } = useReferenceData(keys.some((k) => ["departmentId", "locationId", "designationId"].includes(k)));

  const { data: runs } = useQuery({
    queryKey: ["payroll", "runs", "picker"],
    queryFn: async () => {
      const { data } = await api.get<Array<{ id: string; runNumber: number; status: string; periodId: { name: string } | string }>>("/payroll/runs", { query: { limit: 36 } });
      return data;
    },
    enabled: keys.includes("runId"),
    staleTime: 60_000,
  });

  const { data: leaveTypes } = useQuery({
    queryKey: ["leave", "types", "picker"],
    queryFn: async () => {
      const { data } = await api.get<Array<{ id: string; name: string }>>("/leave/types");
      return data;
    },
    enabled: keys.includes("leaveTypeId"),
    staleTime: 60_000,
  });

  const set = (key: SheetFilterKey, next: string | number | boolean | undefined) => onChange({ ...value, [key]: next === "" ? undefined : next });
  const str = (key: SheetFilterKey) => (value[key] === undefined || value[key] === null ? "" : String(value[key]));

  return (
    <FieldGrid columns={columns}>
      {keys.includes("fromDate") && <Input label={requiresDateRange ? "From" : "From (optional)"} type="date" value={str("fromDate")} onChange={(e) => set("fromDate", e.target.value)} required={requiresDateRange} />}
      {keys.includes("toDate") && <Input label={requiresDateRange ? "To" : "To (optional)"} type="date" value={str("toDate")} onChange={(e) => set("toDate", e.target.value)} required={requiresDateRange} />}
      {keys.includes("runId") && (
        <Select
          label="Payroll run"
          value={str("runId")}
          onChange={(e) => set("runId", e.target.value)}
          placeholder={requiresRun ? "Choose a run" : "Any run"}
          options={(runs || []).map((r) => ({
            value: r.id,
            label: `${typeof r.periodId === "object" ? r.periodId.name : "Period"}${r.runNumber > 1 ? ` (run ${r.runNumber})` : ""} — ${r.status}`,
          }))}
        />
      )}
      {keys.includes("year") && <Input label="Year" type="number" min={2000} max={2100} value={str("year")} onChange={(e) => set("year", e.target.value ? Number(e.target.value) : undefined)} />}
      {keys.includes("departmentId") && (
        <Select label="Department" value={str("departmentId")} onChange={(e) => set("departmentId", e.target.value)} placeholder="All departments" options={departments.map((d) => ({ value: d.id, label: d.name }))} />
      )}
      {keys.includes("locationId") && (
        <Select label="Location" value={str("locationId")} onChange={(e) => set("locationId", e.target.value)} placeholder="All locations" options={locations.map((d) => ({ value: d.id, label: d.name }))} />
      )}
      {keys.includes("designationId") && (
        <Select label="Designation" value={str("designationId")} onChange={(e) => set("designationId", e.target.value)} placeholder="All designations" options={designations.map((d) => ({ value: d.id, label: d.name }))} />
      )}
      {keys.includes("leaveTypeId") && (
        <Select label="Leave type" value={str("leaveTypeId")} onChange={(e) => set("leaveTypeId", e.target.value)} placeholder="All leave types" options={(leaveTypes || []).map((t) => ({ value: t.id, label: t.name }))} />
      )}
      {keys.includes("status") && <Input label="Status" placeholder="e.g. approved, active" value={str("status")} onChange={(e) => set("status", e.target.value)} />}
      {keys.includes("employmentType") && (
        <Select
          label="Employment type"
          value={str("employmentType")}
          onChange={(e) => set("employmentType", e.target.value)}
          placeholder="Any"
          options={["full_time", "part_time", "contract", "intern", "consultant", "temporary"].map((t) => ({ value: t, label: t.replace(/_/g, " ") }))}
        />
      )}
      {keys.includes("includeInactive") && (
        <div className="flex items-end pb-2">
          <Checkbox label="Include former employees" checked={Boolean(value.includeInactive)} onChange={(e) => set("includeInactive", e.target.checked)} />
        </div>
      )}
    </FieldGrid>
  );
}
