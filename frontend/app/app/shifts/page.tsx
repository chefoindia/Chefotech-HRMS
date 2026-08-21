"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useReferenceData, toOptions } from "@/lib/hooks";
import { addDays, formatDate, todayString } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Button,
  Callout,
  Card,
  EmptyState,
  FilterSelect,
  Modal,
  NoAccessState,
  PageHeader,
  Select,
  useToast,
} from "@/components/ui";

interface RosterData {
  fromDate: string;
  toDate: string;
  dates: string[];
  rows: Array<{
    employeeId: string;
    employeeCode: string;
    name: string;
    days: Array<{
      date: string;
      shiftCode: string | null;
      shiftName: string | null;
      colour: string | null;
      startTime: string | null;
      endTime: string | null;
      isWeeklyOff: boolean;
      isHalfDay: boolean;
    }>;
  }>;
}

/**
 * The roster.
 *
 * Two weeks at a time, showing the shift each person is actually on for each
 * day — resolved the same way attendance resolves it, so what you see here is
 * what the engine will use.
 */
export default function ShiftRosterPage() {
  const { session, can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const locale = session?.organization?.locale || "en-IN";
  const timezone = session?.organization?.timezone;

  const [fromDate, setFromDate] = useState(() => todayString(timezone));
  const [departmentId, setDepartmentId] = useState("");
  const [assigning, setAssigning] = useState(false);

  const toDate = addDays(fromDate, 13);
  const reference = useReferenceData(can("shift.view"));

  const { data, isLoading } = useQuery({
    queryKey: ["roster", fromDate, toDate, departmentId],
    queryFn: async () => {
      const { data: payload } = await api.get<RosterData>("/shifts/roster", {
        query: { fromDate, toDate, departmentId: departmentId || undefined },
      });
      return payload;
    },
    enabled: can("shift.view"),
  });

  if (!can("shift.view")) return <NoAccessState what="the roster" />;

  return (
    <>
      <PageHeader
        title="Shift roster"
        description="Two weeks at a glance. This is the same resolution attendance uses — dated assignment, then the employee's standing shift, then the organization default."
        actions={
          <>
            <FilterSelect
              value={departmentId}
              onChange={setDepartmentId}
              options={toOptions(reference.departments)}
              placeholder="All departments"
            />
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setFromDate(addDays(fromDate, -14))}
                aria-label="Previous fortnight"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </Button>
              <span className="min-w-44 text-center text-[13px] font-medium">
                {formatDate(fromDate, { locale })} – {formatDate(toDate, { locale })}
              </span>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setFromDate(addDays(fromDate, 14))}
                aria-label="Next fortnight"
              >
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Button>
            </div>
            {can("shift.assign") && <Button onClick={() => setAssigning(true)}>Assign shifts</Button>}
          </>
        }
      />

      <Card padded={false}>
        {isLoading ? (
          <div className="space-y-2 p-5">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="skeleton h-10" />
            ))}
          </div>
        ) : !data?.rows.length ? (
          <EmptyState
            icon={<CalendarRange className="h-6 w-6" />}
            title="Nobody to roster"
            description="Add employees, or clear the department filter."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b bg-[var(--surface-muted)]">
                  <th className="sticky left-0 z-10 bg-[var(--surface-muted)] px-3 py-2 text-left text-[11.5px] font-semibold uppercase text-[var(--text-muted)]">
                    Employee
                  </th>
                  {data.dates.map((date) => (
                    <th key={date} className="px-1 py-2 text-center font-medium">
                      <span className="block text-[10.5px] text-[var(--text-subtle)]">
                        {new Date(date).toLocaleDateString(locale, { weekday: "narrow" })}
                      </span>
                      <span className="tabular block text-[11.5px] text-[var(--text-muted)]">
                        {date.slice(-2)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.employeeId} className="border-b last:border-0">
                    <td className="sticky left-0 z-10 min-w-44 bg-[var(--surface)] px-3 py-1.5">
                      <p className="truncate text-[12.5px] font-medium text-[var(--text)]">
                        {row.name}
                      </p>
                      <p className="font-mono text-[10.5px] text-[var(--text-muted)]">
                        {row.employeeCode}
                      </p>
                    </td>

                    {row.days.map((day) => (
                      <td key={day.date} className="p-0.5 text-center">
                        {day.isWeeklyOff ? (
                          <span className="block rounded bg-[var(--surface-sunken)] py-1.5 text-[10.5px] text-[var(--text-subtle)]">
                            Off
                          </span>
                        ) : day.shiftCode ? (
                          <span
                            title={`${day.shiftName} · ${day.startTime}–${day.endTime}`}
                            className="block rounded py-1.5 text-[10.5px] font-medium"
                            style={{
                              background: `${day.colour}1f`,
                              color: day.colour || "var(--text)",
                            }}
                          >
                            {day.shiftCode}
                          </span>
                        ) : (
                          <span className="block py-1.5 text-[var(--text-subtle)]">—</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {assigning && (
        <AssignDialog
          shifts={reference.shifts}
          defaultFrom={fromDate}
          defaultTo={toDate}
          onClose={() => setAssigning(false)}
          onDone={() => {
            setAssigning(false);
            queryClient.invalidateQueries({ queryKey: ["roster"] });
          }}
        />
      )}
    </>
  );
}

function AssignDialog({
  shifts,
  defaultFrom,
  defaultTo,
  onClose,
  onDone,
}: {
  shifts: Array<{ id: string; name: string; startTime: string; endTime: string }>;
  defaultFrom: string;
  defaultTo: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    shiftId: "",
    fromDate: defaultFrom,
    toDate: defaultTo,
    employeeIds: [] as string[],
    reason: "",
  });

  const { data: employees } = useQuery({
    queryKey: ["employees", "picker"],
    queryFn: async () => {
      const { data } = await api.get<Array<{ id: string; fullName: string; employeeCode: string }>>(
        "/employees",
        { query: { limit: 200 } }
      );
      return data;
    },
  });

  const assign = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ assigned: number }>("/shifts/assign", form);
      return data;
    },
    onSuccess: (result) => {
      toast.success(
        "Shifts assigned",
        `${result.assigned} ${result.assigned === 1 ? "person" : "people"} updated for that range.`
      );
      onDone();
    },
    onError: (error) => toast.fromError(error, "Could not assign those shifts."),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Assign a shift"
      description="Overrides the standing shift for these dates only. Past attendance is untouched."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={assign.isPending}
            disabled={!form.shiftId || !form.employeeIds.length}
            onClick={() => assign.mutate()}
          >
            Assign to {form.employeeIds.length || 0}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Callout tone="info">
          Any existing assignment overlapping these dates is replaced, so resolution stays
          unambiguous.
        </Callout>

        <Select
          label="Shift"
          value={form.shiftId}
          onChange={(event) => setForm({ ...form, shiftId: event.target.value })}
          options={shifts.map((shift) => ({
            value: shift.id,
            label: `${shift.name} (${shift.startTime}–${shift.endTime})`,
          }))}
          placeholder="Choose a shift"
        />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[13px] font-medium text-[var(--text)]">From</label>
            <input
              type="date"
              value={form.fromDate}
              onChange={(event) => setForm({ ...form, fromDate: event.target.value })}
              className="input-base mt-1.5"
            />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-[var(--text)]">To</label>
            <input
              type="date"
              value={form.toDate}
              min={form.fromDate}
              onChange={(event) => setForm({ ...form, toDate: event.target.value })}
              className="input-base mt-1.5"
            />
          </div>
        </div>

        <div>
          <p className="text-[13px] font-medium text-[var(--text)]">Employees</p>
          <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-[var(--radius)] border p-2">
            {(employees || []).map((employee) => (
              <label
                key={employee.id}
                className="flex cursor-pointer items-center gap-2.5 rounded p-1.5 hover:bg-[var(--surface-muted)]"
              >
                <input
                  type="checkbox"
                  checked={form.employeeIds.includes(employee.id)}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      employeeIds: event.target.checked
                        ? [...form.employeeIds, employee.id]
                        : form.employeeIds.filter((id) => id !== employee.id),
                    })
                  }
                  className="h-4 w-4 rounded border-[var(--border-strong)] accent-[var(--brand-600)]"
                />
                <span className="text-[13px]">
                  {employee.fullName}{" "}
                  <span className="font-mono text-[11.5px] text-[var(--text-muted)]">
                    {employee.employeeCode}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
