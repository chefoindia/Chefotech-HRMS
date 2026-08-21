"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Timer, X } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useListQuery, useListState } from "@/lib/hooks";
import { formatDate, formatMinutes } from "@/lib/format";
import {
  Button,
  Callout,
  Checkbox,
  DataTable,
  NoAccessState,
  PageHeader,
  PersonCell,
  StatusBadge,
  useToast,
  type Column,
} from "@/components/ui";
import type { AttendanceRecord } from "@/lib/types";

/**
 * Overtime approval.
 *
 * Overtime that a policy marks as needing approval is not payable until it is
 * approved here — payroll reads the approved figure, not the accrued one.
 */
export default function OvertimePage() {
  const { session, can } = useSession();
  const locale = session?.organization?.locale || "en-IN";
  const queryClient = useQueryClient();
  const toast = useToast();

  const state = useListState();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { items, total, limit, isLoading, error, refetch } = useListQuery<AttendanceRecord & { id: string }>(
    "overtime",
    "/attendance",
    state,
    {
      limit: 100,
      extraQuery: {
        fromDate: new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10),
        toDate: new Date().toISOString().slice(0, 10),
      },
    }
  );

  const pending = items.filter((row) => row.overtimeStatus === "pending" && row.overtimeMinutes > 0);

  const review = useMutation({
    mutationFn: async (decision: "approve" | "reject") => {
      const { data } = await api.post<{ updated: number }>("/attendance/overtime/review", {
        recordIds: [...selected],
        decision,
      });
      return { ...data, decision };
    },
    onSuccess: (result) => {
      toast.success(
        result.decision === "approve" ? "Overtime approved" : "Overtime rejected",
        `${result.updated} ${result.updated === 1 ? "record" : "records"} updated.`
      );
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["overtime"] });
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
    },
    onError: (err) => toast.fromError(err, "Could not record that decision."),
  });

  if (!can("attendance.approve")) return <NoAccessState what="overtime approval" />;

  const toggle = (id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const columns: Array<Column<AttendanceRecord & { id: string }>> = [
    {
      key: "select",
      header: (
        <Checkbox
          checked={pending.length > 0 && selected.size === pending.length}
          onChange={(event) =>
            setSelected(event.target.checked ? new Set(pending.map((row) => row.id)) : new Set())
          }
        />
      ),
      width: "48px",
      render: (row) => (
        <Checkbox checked={selected.has(row.id)} onChange={(event) => toggle(row.id, event.target.checked)} />
      ),
    },
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
    { key: "date", header: "Date", render: (row) => formatDate(row.date, { locale }) },
    {
      key: "overtimeMinutes",
      header: "Overtime",
      align: "right",
      render: (row) => formatMinutes(row.overtimeMinutes),
    },
    {
      key: "rate",
      header: "Rate",
      align: "right",
      hideBelow: "sm",
      render: (row) => (row.overtimeRate ? `${row.overtimeRate}×` : "—"),
    },
    {
      key: "worked",
      header: "Worked",
      align: "right",
      hideBelow: "md",
      render: (row) => formatMinutes(row.effectiveMinutes),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge status={row.overtimeStatus} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="Overtime"
        description="Overtime accrued in the last 60 days. Approved hours are what payroll pays for."
        actions={
          selected.size > 0 && (
            <>
              <Button
                icon={<Check className="h-4 w-4" />}
                loading={review.isPending}
                onClick={() => review.mutate("approve")}
              >
                Approve {selected.size}
              </Button>
              <Button
                variant="outline"
                icon={<X className="h-4 w-4" />}
                loading={review.isPending}
                onClick={() => review.mutate("reject")}
              >
                Reject
              </Button>
            </>
          )
        }
      />

      <Callout tone="info" className="mb-5">
        Only overtime marked as needing approval appears here. Whether approval is required at all
        is set on the attendance policy.
      </Callout>

      <DataTable
        columns={columns}
        rows={pending}
        rowKey={(row) => row.id}
        loading={isLoading}
        error={error ? (error as Error).message : null}
        onRetry={refetch}
        dense
        emptyIcon={<Timer className="h-6 w-6" />}
        emptyTitle="No overtime waiting"
        emptyDescription="Overtime accrued under your policy shows up here for approval."
      />
    </>
  );
}
