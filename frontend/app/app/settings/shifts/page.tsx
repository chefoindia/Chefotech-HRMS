"use client";

import { Clock } from "lucide-react";
import { useSession } from "@/lib/session";
import { formatMinutes } from "@/lib/format";
import { Badge, Callout, NoAccessState } from "@/components/ui";
import { MasterDataPage } from "@/components/data/MasterDataPage";

interface Shift {
  id: string;
  name: string;
  code: string;
  type: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  isBreakPaid: boolean;
  crossesMidnight: boolean;
  colour: string;
  isDefault: boolean;
  isActive: boolean;
  employeeCount: number;
}

export default function ShiftsSettingsPage() {
  const { can } = useSession();

  if (!can("shift.view")) return <NoAccessState what="shifts" />;

  return (
    <>
      <Callout tone="info" className="mb-5">
        A shift whose end time is earlier than its start time is treated as crossing midnight
        automatically — a 22:00–06:00 shift produces one attendance record for the night it
        started, not two half days.
      </Callout>

      <MasterDataPage<Shift>
        title="Shifts"
        description="When work happens. What counts as late or as a half day is set separately, in an attendance policy, so one policy can cover every shift."
        resource="/shifts"
        queryKey="shifts"
        entityName="Shift"
        can={can}
        permissions={{ view: "shift.view", manage: "shift.manage" }}
        aiEntity="shift"
        addTour="shift-add"
        formTour="shift-form"
        saveTour="shift-save"
        emptyIcon={<Clock className="h-6 w-6" />}
        emptyDescription="Add the shifts your teams work. Most organizations start with one general shift."
        columns={[
          {
            key: "name",
            header: "Shift",
            sortable: true,
            render: (row) => (
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  className="h-3 w-3 shrink-0 rounded"
                  style={{ background: row.colour }}
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className="truncate text-[13.5px] font-medium text-[var(--text)]">
                    {row.name}
                    {row.isDefault && (
                      <span className="ml-2 text-[11px] font-normal text-[var(--text-subtle)]">
                        default
                      </span>
                    )}
                  </p>
                  <p className="font-mono text-[12px] text-[var(--text-muted)]">{row.code}</p>
                </div>
              </div>
            ),
          },
          {
            key: "timing",
            header: "Timing",
            render: (row) => (
              <span className="tabular text-[13px]">
                {row.startTime} – {row.endTime}
                {row.crossesMidnight && (
                  <Badge tone="purple" className="ml-2">
                    Overnight
                  </Badge>
                )}
              </span>
            ),
          },
          {
            key: "breakMinutes",
            header: "Break",
            hideBelow: "sm",
            render: (row) =>
              `${formatMinutes(row.breakMinutes)}${row.isBreakPaid ? " (paid)" : ""}`,
          },
          {
            key: "employeeCount",
            header: "People",
            align: "right",
            render: (row) => row.employeeCount || 0,
          },
        ]}
        fields={[
          { path: "name", label: "Name", required: true, placeholder: "General", tour: "shift-name" },
          { path: "code", label: "Code", required: true, placeholder: "GEN" },
          {
            path: "startTime",
            label: "Start time",
            type: "time",
            required: true,
            tour: "shift-start",
          },
          {
            path: "endTime",
            label: "End time",
            type: "time",
            required: true,
            hint: "Earlier than the start time means the shift runs overnight.",
            tour: "shift-end",
          },
          {
            path: "breakMinutes",
            label: "Break (minutes)",
            type: "number",
            min: 0,
            max: 480,
            tour: "shift-break",
          },
          { path: "isBreakPaid", label: "Break is paid", type: "checkbox" },
          { path: "colour", label: "Colour", type: "color" },
          {
            path: "isDefault",
            label: "Use as the default shift for new employees",
            type: "checkbox",
            colSpan: 2,
          },
        ]}
        defaults={{
          type: "fixed",
          startTime: "09:00",
          endTime: "18:00",
          breakMinutes: 60,
          colour: "#4F46E5",
          isActive: true,
        }}
      />
    </>
  );
}
