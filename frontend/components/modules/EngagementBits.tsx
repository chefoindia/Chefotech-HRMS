"use client";

import { useReferenceData } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { FieldGrid, Select } from "@/components/ui";
import { EmployeeMultiPicker } from "@/components/documents/EmployeePicker";
import type { Audience } from "@/lib/engagementTypes";

/** Who a survey or a review cycle goes to. */
export function AudienceFields({ value, onChange }: { value: Audience; onChange: (next: Audience) => void }) {
  const { departments, locations } = useReferenceData(value.type === "department" || value.type === "location");
  return (
    <div className="space-y-3">
      <FieldGrid columns={2}>
        <Select
          label="Audience"
          value={value.type}
          onChange={(e) => onChange({ ...value, type: e.target.value as Audience["type"] })}
          options={[
            { value: "all", label: "Everyone" },
            { value: "department", label: "One department" },
            { value: "location", label: "One location" },
            { value: "employees", label: "Chosen people" },
          ]}
        />
        {value.type === "department" && <Select label="Department" value={value.departmentId || ""} onChange={(e) => onChange({ ...value, departmentId: e.target.value || null })} placeholder="Choose a department" options={departments.map((d) => ({ value: d.id, label: d.name }))} />}
        {value.type === "location" && <Select label="Location" value={value.locationId || ""} onChange={(e) => onChange({ ...value, locationId: e.target.value || null })} placeholder="Choose a location" options={locations.map((l) => ({ value: l.id, label: l.name }))} />}
      </FieldGrid>
      {value.type === "employees" && <EmployeeMultiPicker selected={value.employeeIds} onChange={(employeeIds) => onChange({ ...value, employeeIds })} />}
    </div>
  );
}

/** 1..max as buttons. */
export function RatingButtons({ value, max, onChange, disabled, lowLabel, highLabel, size = "md" }: { value: number | null | undefined; max: number; onChange?: (n: number) => void; disabled?: boolean; lowLabel?: string; highLabel?: string; size?: "sm" | "md" }) {
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            disabled={disabled || !onChange}
            onClick={() => onChange && onChange(n)}
            aria-pressed={value === n}
            className={cn(
              "rounded-md border text-[13px] font-medium transition-colors",
              size === "sm" ? "h-7 min-w-7 px-2" : "h-9 min-w-9 px-3",
              value === n ? "border-brand-600 bg-brand-600 text-white" : "border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:border-brand-400",
              (disabled || !onChange) && value !== n && "opacity-60"
            )}
          >
            {n}
          </button>
        ))}
      </div>
      {(lowLabel || highLabel) && (
        <div className="mt-1 flex justify-between text-[11.5px] text-[var(--text-muted)]">
          <span>{lowLabel}</span>
          <span>{highLabel}</span>
        </div>
      )}
    </div>
  );
}

export function ProgressBar({ value, tone }: { value: number; tone?: "brand" | "success" | "warning" }) {
  const colour = tone === "success" || value >= 100 ? "bg-[var(--success)]" : tone === "warning" ? "bg-[var(--warning)]" : "bg-brand-600";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-sunken)]" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full transition-all", colour)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

/** Horizontal bars for a distribution or a set of counts. */
export function DistributionBars({ counts, total }: { counts: Record<string, number>; total?: number }) {
  const entries = Object.entries(counts);
  const max = Math.max(1, ...entries.map(([, n]) => n));
  const denominator = total || entries.reduce((a, [, n]) => a + n, 0) || 1;
  return (
    <div className="space-y-1.5">
      {entries.map(([label, n]) => (
        <div key={label} className="flex items-center gap-2 text-[12.5px]">
          <span className="w-24 shrink-0 truncate text-[var(--text-muted)]" title={label}>
            {label}
          </span>
          <div className="h-2.5 flex-1 overflow-hidden rounded bg-[var(--surface-sunken)]">
            <div className="h-full rounded bg-brand-500" style={{ width: `${(n / max) * 100}%` }} />
          </div>
          <span className="w-16 shrink-0 text-right tabular text-[var(--text)]">
            {n} <span className="text-[var(--text-muted)]">({Math.round((n / denominator) * 100)}%)</span>
          </span>
        </div>
      ))}
    </div>
  );
}
