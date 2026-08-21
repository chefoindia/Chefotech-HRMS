"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Clock, RefreshCw, Users } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useListQuery, useListState, useReferenceData, toOptions } from "@/lib/hooks";
import { formatMinutes, formatTime, humanise, todayString } from "@/lib/format";
import { refLabel } from "@/lib/utils";
import {
  Button,
  Card,
  DataTable,
  FilterSelect,
  Modal,
  PageHeader,
  PersonCell,
  Select,
  StatCard,
  StatusBadge,
  TableToolbar,
  Textarea,
  useToast,
  type Column,
} from "@/components/ui";
import type { AttendanceRecord } from "@/lib/types";

const STATUS_OPTIONS = [
  "present",
  "absent",
  "half_day",
  "leave",
  "weekly_off",
  "holiday",
  "work_from_home",
  "on_duty",
  "pending",
].map((value) => ({ value, label: humanise(value) }));

export default function DailyAttendancePage() {
  const { session, can } = useSession();
  const timezone = session?.organization?.timezone;
  const locale = session?.organization?.locale || "en-IN";
  const queryClient = useQueryClient();
  const toast = useToast();

  const [date, setDate] = useState(() => todayString(timezone));
  const [editing, setEditing] = useState<AttendanceRecord | null>(null);

  const state = useListState();
  const reference = useReferenceData();

  const { data: snapshot } = useQuery({
    queryKey: ["attendance", "today"],
    queryFn: async () => {
      const { data } = await api.get<{
        totalEmployees: number;
        present: number;
        absent: number;
        onLeave: number;
        late: number;
        notMarked: number;
        attendancePercent: number;
      }>("/attendance/today");
      return data;
    },
    enabled: can("attendance.view") && date === todayString(timezone),
  });

  const { items, total, limit, isLoading, error, refetch } = useListQuery<AttendanceRecord>(
    "attendance",
    "/attendance",
    state,
    { limit: 50, extraQuery: { fromDate: date, toDate: date } }
  );

  const recalculate = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ queued?: boolean; processed?: number }>("/attendance/process", {
        fromDate: date,
        toDate: date,
      });
      return data;
    },
    onSuccess: (result) => {
      if (result.queued) {
        toast.info("Recalculation queued", "It will finish in the background.");
      } else {
        toast.success("Attendance recalculated", `${result.processed} records updated.`);
      }
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
    },
    onError: (err) => toast.fromError(err, "Could not recalculate attendance."),
  });

  const columns: Array<Column<AttendanceRecord>> = [
    {
      key: "employee",
      header: "Employee",
      render: (row) => {
        const employee = typeof row.employeeId === "object" ? row.employeeId : null;
        return (
          <PersonCell
            name={
              employee
                ? [employee.personal?.firstName, employee.personal?.lastName].filter(Boolean).join(" ")
                : "Unknown"
            }
            code={employee?.employeeCode}
          />
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={row.status} />
          {row.isLate && <StatusBadge status="pending" label={`Late ${row.lateByMinutes}m`} />}
          {row.isMissingPunch && (
            <span className="inline-flex items-center gap-1 text-[11.5px] text-[var(--warning)]">
              <AlertTriangle className="h-3 w-3" aria-hidden />
              Missing punch
            </span>
          )}
        </div>
      ),
    },
    {
      key: "in",
      header: "In",
      hideBelow: "sm",
      render: (row) => (row.firstPunchAt ? formatTime(row.firstPunchAt, { locale, timezone }) : "—"),
    },
    {
      key: "out",
      header: "Out",
      hideBelow: "sm",
      render: (row) => (row.lastPunchAt ? formatTime(row.lastPunchAt, { locale, timezone }) : "—"),
    },
    {
      key: "worked",
      header: "Worked",
      align: "right",
      hideBelow: "md",
      render: (row) => formatMinutes(row.effectiveMinutes),
    },
    {
      key: "overtime",
      header: "Overtime",
      align: "right",
      hideBelow: "lg",
      render: (row) =>
        row.overtimeMinutes ? (
          <span className={row.overtimeStatus === "approved" ? "text-[var(--success)]" : undefined}>
            {formatMinutes(row.overtimeMinutes)}
          </span>
        ) : (
          "—"
        ),
    },
    {
      key: "payable",
      header: "Payable",
      align: "right",
      hideBelow: "md",
      render: (row) => row.payableDays,
    },
  ];

  return (
    <>
      <PageHeader
        title="Attendance"
        description="Who was in, who was late, and what each day is worth in payable days."
        actions={
          <>
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              aria-label="Date"
              className="input-base h-9 w-auto"
            />
            {can("attendance.manage") && (
              <Button
                variant="outline"
                icon={<RefreshCw className="h-4 w-4" />}
                loading={recalculate.isPending}
                onClick={() => recalculate.mutate()}
              >
                Recalculate
              </Button>
            )}
          </>
        }
      />

      {snapshot && (
        <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Present"
            value={`${snapshot.present}/${snapshot.totalEmployees}`}
            hint={`${snapshot.attendancePercent}% attendance`}
            icon={<Users className="h-5 w-5" />}
            tone="success"
          />
          <StatCard label="Absent" value={snapshot.absent} tone="danger" />
          <StatCard label="On leave" value={snapshot.onLeave} tone="info" />
          <StatCard
            label="Late"
            value={snapshot.late}
            hint={snapshot.notMarked ? `${snapshot.notMarked} not marked` : undefined}
            icon={<Clock className="h-5 w-5" />}
            tone="warning"
          />
        </div>
      )}

      <DataTable
        columns={columns}
        rows={items}
        rowKey={(row, index) => row.id || `${row.date}-${index}`}
        loading={isLoading}
        error={error ? (error as Error).message : null}
        onRetry={refetch}
        onRowClick={can("attendance.manage") ? (row) => setEditing(row) : undefined}
        page={state.page}
        limit={limit}
        total={total}
        onPageChange={state.setPage}
        emptyIcon={<Clock className="h-6 w-6" />}
        emptyTitle="No attendance for this date"
        emptyDescription="Either no punches have arrived yet, or attendance has not been processed for this day."
        toolbar={
          <TableToolbar
            search={state.search}
            onSearchChange={state.setSearch}
            placeholder="Search employees"
            activeFilterCount={state.activeFilterCount}
            onClearFilters={state.clearFilters}
            filters={
              <>
                <FilterSelect
                  value={state.filters.departmentId || ""}
                  onChange={(value) => state.setFilter("departmentId", value)}
                  options={toOptions(reference.departments)}
                  placeholder="All departments"
                />
                <FilterSelect
                  value={state.filters.status || ""}
                  onChange={(value) => state.setFilter("status", value)}
                  options={STATUS_OPTIONS}
                  placeholder="Any status"
                />
                <FilterSelect
                  value={state.filters.isLate || ""}
                  onChange={(value) => state.setFilter("isLate", value)}
                  options={[{ value: "true", label: "Late only" }]}
                  placeholder="Late"
                />
                <FilterSelect
                  value={state.filters.isMissingPunch || ""}
                  onChange={(value) => state.setFilter("isMissingPunch", value)}
                  options={[{ value: "true", label: "Missing punch only" }]}
                  placeholder="Exceptions"
                />
              </>
            }
          />
        }
      />

      {editing && (
        <OverrideDialog
          record={editing}
          date={date}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            queryClient.invalidateQueries({ queryKey: ["attendance"] });
          }}
        />
      )}
    </>
  );
}

function OverrideDialog({
  record,
  date,
  onClose,
  onDone,
}: {
  record: AttendanceRecord;
  date: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const employee = typeof record.employeeId === "object" ? record.employeeId : null;
  const employeeId = typeof record.employeeId === "object" ? (record.employeeId as { _id?: string })._id : record.employeeId;

  const [status, setStatus] = useState(record.status);
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [reason, setReason] = useState("");

  const save = useMutation({
    mutationFn: async () => {
      await api.post(`/attendance/employee/${employeeId}/${date}`, {
        status,
        checkIn: checkIn || undefined,
        checkOut: checkOut || undefined,
        reason,
      });
    },
    onSuccess: () => {
      toast.success("Attendance updated", "The change is recorded in the audit trail.");
      onDone();
    },
    onError: (error) => toast.fromError(error, "Could not update this record."),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Correct attendance"
      description={
        employee
          ? `${[employee.personal?.firstName, employee.personal?.lastName].filter(Boolean).join(" ")} · ${date}`
          : date
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!reason.trim()}>
            Save correction
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {record.isLocked && (
          <p className="rounded-md bg-[var(--warning-bg)] p-3 text-[13px] text-[var(--warning)]">
            This day is locked for payroll. Unlock the period before changing it.
          </p>
        )}

        {record.breakdown?.length > 0 && (
          <div className="rounded-[var(--radius)] border bg-[var(--surface-muted)] p-3">
            <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
              How this was calculated
            </p>
            <ul className="space-y-1">
              {record.breakdown.map((entry, index) => (
                <li key={index} className="flex gap-2 text-[12.5px]">
                  <span className="text-[var(--text-muted)]">{entry.detail}</span>
                  <span className="ml-auto shrink-0 font-medium text-[var(--text)]">
                    {entry.effect}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <Select
          label="Status"
          value={status}
          onChange={(event) => setStatus(event.target.value as AttendanceRecord["status"])}
          options={[
            "present",
            "absent",
            "half_day",
            "leave",
            "weekly_off",
            "holiday",
            "on_duty",
            "work_from_home",
            "comp_off",
          ].map((value) => ({ value, label: humanise(value) }))}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-[13px] font-medium text-[var(--text)]">Check in</label>
            <input
              type="time"
              value={checkIn}
              onChange={(event) => setCheckIn(event.target.value)}
              className="input-base mt-1.5"
            />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-[var(--text)]">Check out</label>
            <input
              type="time"
              value={checkOut}
              onChange={(event) => setCheckOut(event.target.value)}
              className="input-base mt-1.5"
            />
          </div>
        </div>

        <Textarea
          label="Reason"
          required
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why is this being changed? Recorded in the audit trail."
          rows={2}
        />
      </div>
    </Modal>
  );
}
