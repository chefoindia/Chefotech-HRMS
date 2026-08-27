"use client";

import { CalendarRange } from "lucide-react";
import { useSession } from "@/lib/session";
import { Badge, Callout, NoAccessState } from "@/components/ui";
import { MasterDataPage } from "@/components/data/MasterDataPage";
import { WeekOffEditor, emptyWeek, toWeek, type WeekOffDay } from "@/components/shifts/WeekOffEditor";

/**
 * Week off patterns — which days of the week a group does not work.
 *
 * The backend, the model and the attendance resolver for these have existed
 * since the shift module was built; only the screen was missing, so the
 * feature was reachable by calling the API and no other way. That is why this
 * page is new while nothing behind it is.
 *
 * Deliberately separate from Shifts. A shift says *when* a working day runs;
 * this says *which days are working days at all*. Organizations mix them
 * freely — one general shift against a five-day office week and a six-day
 * plant week — and folding them together would force a duplicate shift for
 * every combination.
 */

interface WeeklyOffPolicy {
  id: string;
  name: string;
  code: string;
  description?: string;
  days: WeekOffDay[];
  isDefault: boolean;
  isActive: boolean;
}

const DAY_INITIALS = ["S", "M", "T", "W", "T", "F", "S"];

/** A compact read of the whole week, for the list row. */
function WeekSummary({ days }: { days: WeekOffDay[] }) {
  const week = toWeek(days);

  return (
    <span className="flex items-center gap-1">
      {week.map((entry, index) => {
        const tone =
          entry.type === "off"
            ? "bg-brand-600 text-white"
            : entry.type === "half_day"
              ? "bg-brand-100 text-brand-700"
              : entry.type === "alternate"
                ? "bg-amber-100 text-amber-700"
                : "bg-[var(--surface-sunken)] text-[var(--text-subtle)]";

        const label =
          entry.type === "alternate"
            ? `Off on the ${(entry.offOccurrences ?? []).join(" and ")} of each month`
            : entry.type === "half_day"
              ? `Half day, ${entry.halfDaySession === "second" ? "afternoon" : "morning"} worked`
              : entry.type === "off"
                ? "Week off"
                : "Working";

        return (
          <span
            key={entry.day}
            title={label}
            className={`grid h-6 w-6 place-items-center rounded text-[11px] font-medium ${tone}`}
          >
            {DAY_INITIALS[index]}
          </span>
        );
      })}
    </span>
  );
}

export default function WeekOffSettingsPage() {
  const { can } = useSession();

  if (!can("shift.view")) return <NoAccessState what="week off patterns" />;

  return (
    <>
      <Callout tone="info" className="mb-5">
        Days are numbered from Sunday regardless of which day your reports start the week on —
        that setting changes how a week is drawn, not which day is which. Use{" "}
        <strong>Alternate</strong> for rules like &ldquo;2nd and 4th Saturday off&rdquo;.
      </Callout>

      <MasterDataPage<WeeklyOffPolicy>
        title="Week off patterns"
        description="Which days each group does not work. Assign a pattern to an employee alongside their shift — the shift sets the hours, this sets the days."
        resource="/shifts/weekly-off"
        queryKey="weekly-off"
        entityName="Week off pattern"
        can={can}
        permissions={{ view: "shift.view", manage: "shift.manage" }}
        aiEntity="weekly_off"
        emptyIcon={<CalendarRange className="h-6 w-6" />}
        emptyDescription="Add the working weeks your teams keep. Most organizations start with one five-day office week."
        defaults={{ days: emptyWeek(), isActive: true }}
        columns={[
          { key: "name", header: "Pattern", sortable: true },
          { key: "code", header: "Code", hideBelow: "sm" },
          {
            key: "days",
            header: "Week",
            render: (row) => <WeekSummary days={row.days} />,
          },
          {
            key: "isDefault",
            header: "",
            render: (row) =>
              row.isDefault ? (
                <Badge tone="brand">Default</Badge>
              ) : row.isActive ? null : (
                <Badge tone="neutral">Inactive</Badge>
              ),
          },
        ]}
        fields={[
          {
            path: "name",
            label: "Name",
            required: true,
            placeholder: "Office — 5 day week",
            hint: "Name it after the group it governs, not a rule inside it.",
          },
          {
            path: "code",
            label: "Code",
            required: true,
            placeholder: "OFF5",
            hint: "Short and stable — imports and exports reference it.",
          },
          { path: "description", label: "Note", type: "textarea", colSpan: 2 },
          {
            path: "days",
            label: "Each day of the week",
            // The seven-day grid is the whole substance of this record, so it
            // gets a real editor rather than being flattened into inputs.
            render: ({ value, onChange }) => (
              <WeekOffEditor value={value} onChange={(days) => onChange(days)} />
            ),
          },
          {
            path: "isDefault",
            label: "Use for employees with no pattern set",
            type: "checkbox",
            hint: "Including everyone created by a spreadsheet import. Only one pattern can hold this.",
          },
          {
            path: "isActive",
            label: "Available to assign",
            type: "checkbox",
            hint: "Turning this off hides it from pickers without changing attendance already measured against it.",
          },
        ]}
        // The seven days must arrive complete and in order; the editor keeps
        // them that way on screen, but a record created straight from the
        // defaults never passes through it.
        beforeSave={(values) => ({ ...values, days: toWeek(values.days) })}
      />
    </>
  );
}
