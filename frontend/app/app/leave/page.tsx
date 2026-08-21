"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Check, Plus, X } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useListQuery, useListState, useReferenceData, toOptions } from "@/lib/hooks";
import { formatDate, formatDays, humanise } from "@/lib/format";
import {
  Button,
  DataTable,
  FilterSelect,
  LinkButton,
  Modal,
  PageHeader,
  PersonCell,
  StatusBadge,
  TableToolbar,
  Textarea,
  useToast,
  type Column,
} from "@/components/ui";
import type { LeaveRequest } from "@/lib/types";

export default function LeaveRequestsPage() {
  const { session, can, canAny } = useSession();
  const locale = session?.organization?.locale || "en-IN";
  const queryClient = useQueryClient();
  const toast = useToast();

  const state = useListState({ sort: "-createdAt", filters: { status: "pending" } });
  const reference = useReferenceData();
  const [reviewing, setReviewing] = useState<{ request: LeaveRequest; decision: "approve" | "reject" } | null>(null);

  const { items, total, limit, isLoading, error, refetch } = useListQuery<LeaveRequest>(
    "leave-requests",
    "/leave/requests",
    state
  );

  const columns: Array<Column<LeaveRequest>> = [
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
      key: "type",
      header: "Type",
      render: (row) => {
        const type = typeof row.leaveTypeId === "object" ? row.leaveTypeId : null;
        return (
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: type?.colour || "var(--border-strong)" }}
              aria-hidden
            />
            {type?.name || "Leave"}
          </span>
        );
      },
    },
    {
      key: "dates",
      header: "Dates",
      render: (row) => (
        <span className="text-[13px]">
          {formatDate(row.fromDate, { locale })}
          {row.fromDate !== row.toDate && ` → ${formatDate(row.toDate, { locale })}`}
        </span>
      ),
    },
    {
      key: "leaveDays",
      header: "Days",
      align: "right",
      render: (row) => (
        <span title={`${row.calendarDays} calendar days`}>{row.leaveDays}</span>
      ),
    },
    {
      key: "reason",
      header: "Reason",
      hideBelow: "lg",
      render: (row) => (
        <span className="line-clamp-1 text-[13px] text-[var(--text-muted)]">{row.reason}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) =>
        row.status === "pending" && canAny("leave.approve", "leave.reject") ? (
          <div className="flex justify-end gap-1">
            {can("leave.approve") && (
              <Button
                size="sm"
                variant="outline"
                icon={<Check className="h-3.5 w-3.5" />}
                onClick={(event) => {
                  event.stopPropagation();
                  setReviewing({ request: row, decision: "approve" });
                }}
              >
                Approve
              </Button>
            )}
            {can("leave.reject") && (
              <Button
                size="sm"
                variant="ghost"
                icon={<X className="h-3.5 w-3.5" />}
                onClick={(event) => {
                  event.stopPropagation();
                  setReviewing({ request: row, decision: "reject" });
                }}
              >
                Reject
              </Button>
            )}
          </div>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Leave requests"
        description="Everything your role can see, filtered to pending by default."
        actions={
          can("leave.apply_on_behalf") ? (
            <LinkButton href="/app/leave/apply" icon={<Plus className="h-4 w-4" />}>
              Apply on behalf
            </LinkButton>
          ) : undefined
        }
      />

      <DataTable
        columns={columns}
        rows={items}
        rowKey={(row) => row.id}
        loading={isLoading}
        error={error ? (error as Error).message : null}
        onRetry={refetch}
        page={state.page}
        limit={limit}
        total={total}
        onPageChange={state.setPage}
        emptyIcon={<CalendarDays className="h-6 w-6" />}
        emptyTitle={
          state.filters.status === "pending" ? "Nothing waiting for approval" : "No leave requests"
        }
        emptyDescription={
          state.filters.status === "pending"
            ? "Requests appear here as soon as someone applies."
            : "Try changing the filters."
        }
        toolbar={
          <TableToolbar
            search={state.search}
            onSearchChange={state.setSearch}
            placeholder="Search by employee"
            activeFilterCount={state.activeFilterCount}
            onClearFilters={state.clearFilters}
            filters={
              <>
                <FilterSelect
                  value={state.filters.status || ""}
                  onChange={(value) => state.setFilter("status", value)}
                  options={["pending", "approved", "rejected", "cancelled"].map((value) => ({
                    value,
                    label: humanise(value),
                  }))}
                  placeholder="Any status"
                />
                <FilterSelect
                  value={state.filters.departmentId || ""}
                  onChange={(value) => state.setFilter("departmentId", value)}
                  options={toOptions(reference.departments)}
                  placeholder="All departments"
                />
              </>
            }
          />
        }
      />

      {reviewing && (
        <ReviewDialog
          request={reviewing.request}
          decision={reviewing.decision}
          locale={locale}
          onClose={() => setReviewing(null)}
          onDone={() => {
            setReviewing(null);
            queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
            queryClient.invalidateQueries({ queryKey: ["approvals"] });
          }}
        />
      )}
    </>
  );
}

function ReviewDialog({
  request,
  decision,
  locale,
  onClose,
  onDone,
}: {
  request: LeaveRequest;
  decision: "approve" | "reject";
  locale: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [comment, setComment] = useState("");

  const employee = typeof request.employeeId === "object" ? request.employeeId : null;
  const type = typeof request.leaveTypeId === "object" ? request.leaveTypeId : null;
  const name = employee
    ? [employee.personal?.firstName, employee.personal?.lastName].filter(Boolean).join(" ")
    : "This employee";

  const decide = useMutation({
    mutationFn: async () => {
      await api.post(`/leave/requests/${request.id}/decide`, { decision, comment });
    },
    onSuccess: () => {
      toast.success(
        decision === "approve" ? "Leave approved" : "Leave rejected",
        decision === "approve"
          ? "Their balance and attendance for those days have been updated."
          : "The days have been returned to their balance."
      );
      onDone();
    },
    onError: (error) => toast.fromError(error, "Could not record that decision."),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={decision === "approve" ? "Approve leave" : "Reject leave"}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={decision === "approve" ? "primary" : "danger"}
            onClick={() => decide.mutate()}
            loading={decide.isPending}
            disabled={decision === "reject" && !comment.trim()}
          >
            {decision === "approve" ? "Approve" : "Reject"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-[var(--radius)] border bg-[var(--surface-muted)] p-3.5">
          <p className="text-[14px] font-medium text-[var(--text)]">
            {name} · {type?.name || "Leave"}
          </p>
          <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">
            {formatDate(request.fromDate, { locale })}
            {request.fromDate !== request.toDate && ` → ${formatDate(request.toDate, { locale })}`}
            {" · "}
            {formatDays(request.leaveDays)} deducted from {request.calendarDays} calendar days
          </p>
          <p className="mt-2 text-[13px] text-[var(--text)]">{request.reason}</p>
        </div>

        {request.calculation?.breakdown && (
          <div>
            <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
              How the days were counted
            </p>
            <ul className="space-y-1">
              {request.calculation.breakdown.map((entry, index) => (
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

        <Textarea
          label={decision === "approve" ? "Comment (optional)" : "Reason for rejecting"}
          required={decision === "reject"}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder={
            decision === "approve"
              ? "Anything you want on the record"
              : "The employee sees this, so be clear"
          }
          rows={3}
        />
      </div>
    </Modal>
  );
}
