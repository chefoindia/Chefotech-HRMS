"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Clock, X } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useListQuery, useListState } from "@/lib/hooks";
import { formatDate, formatRelative, humanise } from "@/lib/format";
import {
  Button,
  DataTable,
  FilterSelect,
  Modal,
  PageHeader,
  PersonCell,
  StatusBadge,
  TableToolbar,
  Textarea,
  useToast,
  type Column,
} from "@/components/ui";

interface Correction {
  id: string;
  date: string;
  type: string;
  reason: string;
  requested: { checkIn: string | null; checkOut: string | null; status: string | null };
  status: string;
  createdAt: string;
  reviewComment: string;
  employeeId: { employeeCode: string; personal: { firstName: string; lastName: string } } | string;
}

export default function CorrectionsPage() {
  const { session, can } = useSession();
  const locale = session?.organization?.locale || "en-IN";
  const queryClient = useQueryClient();
  const toast = useToast();

  const state = useListState({ filters: { status: "pending" } });
  const [reviewing, setReviewing] = useState<{ row: Correction; decision: "approve" | "reject" } | null>(
    null
  );

  const { items, total, limit, isLoading, error, refetch } = useListQuery<Correction>(
    "corrections",
    "/attendance/corrections",
    state
  );

  const review = useMutation({
    mutationFn: async ({ id, decision, comment }: { id: string; decision: string; comment: string }) => {
      await api.post(`/attendance/corrections/${id}/review`, { decision, comment });
    },
    onSuccess: () => {
      toast.success("Decision recorded", "The day has been recalculated.");
      setReviewing(null);
      queryClient.invalidateQueries({ queryKey: ["corrections"] });
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
    },
    onError: (err) => toast.fromError(err, "Could not record that decision."),
  });

  const columns: Array<Column<Correction>> = [
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
    { key: "type", header: "Type", hideBelow: "sm", render: (row) => humanise(row.type) },
    {
      key: "requested",
      header: "Requested",
      hideBelow: "md",
      render: (row) =>
        [
          row.requested?.checkIn && `in ${row.requested.checkIn}`,
          row.requested?.checkOut && `out ${row.requested.checkOut}`,
          row.requested?.status && humanise(row.requested.status),
        ]
          .filter(Boolean)
          .join(", ") || "—",
    },
    {
      key: "reason",
      header: "Reason",
      hideBelow: "lg",
      render: (row) => <span className="line-clamp-1 text-[13px]">{row.reason}</span>,
    },
    { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) =>
        row.status === "pending" && can("attendance.approve") ? (
          <div className="flex justify-end gap-1">
            <Button
              size="sm"
              variant="outline"
              icon={<Check className="h-3.5 w-3.5" />}
              onClick={() => setReviewing({ row, decision: "approve" })}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<X className="h-3.5 w-3.5" />}
              onClick={() => setReviewing({ row, decision: "reject" })}
            >
              Reject
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Attendance corrections"
        description="Requests to fix a missing or wrong punch. Approving one recalculates that day immediately."
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
        emptyIcon={<Clock className="h-6 w-6" />}
        emptyTitle="No correction requests"
        emptyDescription="When someone forgets to punch, their request lands here."
        toolbar={
          <TableToolbar
            activeFilterCount={state.activeFilterCount}
            onClearFilters={state.clearFilters}
            filters={
              <FilterSelect
                value={state.filters.status || ""}
                onChange={(value) => state.setFilter("status", value)}
                options={["pending", "approved", "rejected"].map((value) => ({
                  value,
                  label: humanise(value),
                }))}
                placeholder="Any status"
              />
            }
          />
        }
      />

      {reviewing && (
        <ReviewDialog
          correction={reviewing.row}
          decision={reviewing.decision}
          locale={locale}
          loading={review.isPending}
          onClose={() => setReviewing(null)}
          onConfirm={(comment) =>
            review.mutate({ id: reviewing.row.id, decision: reviewing.decision, comment })
          }
        />
      )}
    </>
  );
}

function ReviewDialog({
  correction,
  decision,
  locale,
  loading,
  onClose,
  onConfirm,
}: {
  correction: Correction;
  decision: "approve" | "reject";
  locale: string;
  loading: boolean;
  onClose: () => void;
  onConfirm: (comment: string) => void;
}) {
  const [comment, setComment] = useState("");
  const employee = typeof correction.employeeId === "object" ? correction.employeeId : null;

  return (
    <Modal
      open
      onClose={onClose}
      title={decision === "approve" ? "Approve this correction" : "Reject this correction"}
      description={`${
        employee
          ? [employee.personal?.firstName, employee.personal?.lastName].filter(Boolean).join(" ")
          : ""
      } · ${formatDate(correction.date, { locale })}`}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={decision === "approve" ? "primary" : "danger"}
            loading={loading}
            disabled={decision === "reject" && !comment.trim()}
            onClick={() => onConfirm(comment)}
          >
            {decision === "approve" ? "Approve" : "Reject"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-[var(--radius)] border bg-[var(--surface-muted)] p-3">
          <p className="text-[13px] text-[var(--text)]">{correction.reason}</p>
          <p className="mt-1 text-[12px] text-[var(--text-muted)]">
            {humanise(correction.type)} · raised {formatRelative(correction.createdAt)}
          </p>
        </div>

        {decision === "approve" && (
          <p className="text-[13px] text-[var(--text-muted)]">
            Approving writes the requested times as manual punches and recalculates the day with
            your attendance policy.
          </p>
        )}

        <Textarea
          label={decision === "approve" ? "Comment (optional)" : "Reason for rejecting"}
          required={decision === "reject"}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          rows={3}
          autoFocus
        />
      </div>
    </Modal>
  );
}
