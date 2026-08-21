"use client";

import { Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useReferenceData, toOptions } from "@/lib/hooks";
import { humanise, monthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Button,
  Card,
  EmptyState,
  FilterSelect,
  NoAccessState,
  PageHeader,
  PageLoader,
  useToast,
} from "@/components/ui";

interface MonthlyRow {
  employeeCode: string;
  name: string;
  department: string;
  present: number;
  halfDay: number;
  absent: number;
  leave: number;
  weeklyOff: number;
  holiday: number;
  late: number;
  payableDays: number;
  overtimeHours: number;
}

/**
 * The monthly register.
 *
 * Runs the same report the export produces, so what is on screen and what
 * lands in the spreadsheet can never disagree.
 */
function MonthlyAttendance() {
  const { session, can } = useSession();
  const toast = useToast();
  const locale = session?.organization?.locale || "en-IN";

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [departmentId, setDepartmentId] = useState("");

  const reference = useReferenceData(can("attendance.view"));

  const bounds = {
    fromDate: `${year}-${String(month).padStart(2, "0")}-01`,
    toDate: new Date(year, month, 0).toISOString().slice(0, 10),
  };

  const { data, isLoading } = useQuery({
    queryKey: ["attendance", "monthly", year, month, departmentId],
    queryFn: async () => {
      const { data: payload } = await api.get<{ rows: MonthlyRow[]; total: number }>(
        "/reports/attendance_summary/run",
        { query: { ...bounds, departmentId: departmentId || undefined, limit: 500 } }
      );
      return payload;
    },
    enabled: can("attendance.view"),
  });

  const shift = (delta: number) => {
    const next = new Date(year, month - 1 + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth() + 1);
  };

  const exportMonth = async () => {
    try {
      await api.download("/reports/attendance_summary/run", {
        ...bounds,
        departmentId: departmentId || undefined,
        format: "xlsx",
      });
      toast.success("Export started");
    } catch (error) {
      toast.fromError(error, "Could not export the register.");
    }
  };

  if (!can("attendance.view")) return <NoAccessState what="the monthly register" />;

  return (
    <>
      <PageHeader
        title="Monthly attendance"
        description="Per-employee totals for the month — the same figures payroll reads."
        actions={
          <>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" onClick={() => shift(-1)} aria-label="Previous month">
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </Button>
              <span className="min-w-36 text-center text-[14px] font-medium">
                {monthLabel(year, month, locale)}
              </span>
              <Button
                variant="outline"
                size="icon"
                onClick={() => shift(1)}
                aria-label="Next month"
                disabled={year === now.getFullYear() && month === now.getMonth() + 1}
              >
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Button>
            </div>

            {can("attendance.export") && (
              <Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={exportMonth}>
                Export
              </Button>
            )}
          </>
        }
      />

      <Card padded={false}>
        <div className="border-b p-3">
          <FilterSelect
            value={departmentId}
            onChange={setDepartmentId}
            options={toOptions(reference.departments)}
            placeholder="All departments"
          />
        </div>

        {isLoading ? (
          <div className="space-y-2 p-5">
            {[0, 1, 2, 3, 4].map((index) => (
              <div key={index} className="skeleton h-8" />
            ))}
          </div>
        ) : !data?.rows.length ? (
          <EmptyState
            title="No attendance for this month"
            description="Either nobody has been processed yet, or the filters exclude everyone."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b bg-[var(--surface-muted)]">
                  {[
                    "Employee",
                    "Department",
                    "Present",
                    "Half",
                    "Absent",
                    "Leave",
                    "Off",
                    "Holiday",
                    "Late",
                    "Payable",
                    "OT hrs",
                  ].map((header, index) => (
                    <th
                      key={header}
                      className={cn(
                        "px-3 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--text-muted)]",
                        index < 2 ? "text-left" : "text-right"
                      )}
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.employeeCode} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      <p className="font-medium text-[var(--text)]">{row.name}</p>
                      <p className="font-mono text-[11.5px] text-[var(--text-muted)]">
                        {row.employeeCode}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">{row.department || "—"}</td>
                    <td className="tabular px-3 py-2 text-right">{row.present}</td>
                    <td className="tabular px-3 py-2 text-right">{row.halfDay || "—"}</td>
                    <td
                      className={cn(
                        "tabular px-3 py-2 text-right",
                        row.absent > 0 && "font-medium text-[var(--danger)]"
                      )}
                    >
                      {row.absent || "—"}
                    </td>
                    <td className="tabular px-3 py-2 text-right">{row.leave || "—"}</td>
                    <td className="tabular px-3 py-2 text-right text-[var(--text-muted)]">
                      {row.weeklyOff}
                    </td>
                    <td className="tabular px-3 py-2 text-right text-[var(--text-muted)]">
                      {row.holiday || "—"}
                    </td>
                    <td
                      className={cn(
                        "tabular px-3 py-2 text-right",
                        row.late > 2 && "font-medium text-[var(--warning)]"
                      )}
                    >
                      {row.late || "—"}
                    </td>
                    <td className="tabular px-3 py-2 text-right font-semibold">{row.payableDays}</td>
                    <td className="tabular px-3 py-2 text-right">{row.overtimeHours || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

export default function MonthlyAttendancePage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <MonthlyAttendance />
    </Suspense>
  );
}
