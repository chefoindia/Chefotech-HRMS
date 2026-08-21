"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ClipboardCheck, Clock, X } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatDate, formatRelative, humanise } from "@/lib/format";
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  Modal,
  PageHeader,
  PersonCell,
  StatusBadge,
  Tabs,
  Textarea,
  useToast,
} from "@/components/ui";
import type { LeaveRequest } from "@/lib/types";

interface Correction {
  id: string;
  date: string;
  type: string;
  reason: string;
  requested: { checkIn: string | null; checkOut: string | null; status: string | null };
  status: string;
  createdAt: string;
  employeeId: { employeeCode: string; personal: { firstName: string; lastName: string } } | string;
}

/**
 * Everything waiting on this person, in one place.
 *
 * Split by type rather than merged into one list: approving leave and
 * approving an attendance correction need different context, and pretending
 * they are the same row type makes both worse.
 */
export default function ApprovalsPage() {
  const { session, can } = useSession();
  const locale = session?.organization?.locale || "en-IN";
  const queryClient = useQueryClient();
  const toast = useToast();

  const [tab, setTab] = useState("leave");
  const [reviewing, setReviewing] = useState<
    { kind: "leave" | "correction"; id: string; decision: "approve" | "reject"; label: string } | null
  >(null);

  const leave = useQuery({
    queryKey: ["approvals", "leave"],
    queryFn: async () => {
      const { data } = await api.get<LeaveRequest[]>("/leave/requests", {
        query: { status: "pending", limit: 50 },
      });
      return data;
    },
    enabled: can("leave.approve"),
  });

  const corrections = useQuery({
    queryKey: ["approvals", "corrections"],
    queryFn: async () => {
      const { data } = await api.get<Correction[]>("/attendance/corrections", {
        query: { status: "pending", limit: 50 },
      });
      return data;
    },
    enabled: can("attendance.approve"),
  });

  const decide = useMutation({
    mutationFn: async ({
      kind,
      id,
      decision,
      comment,
    }: {
      kind: "leave" | "correction";
      id: string;
      decision: "approve" | "reject";
      comment: string;
    }) => {
      if (kind === "leave") {
        await api.post(`/leave/requests/${id}/decide`, { decision, comment });
      } else {
        await api.post(`/attendance/corrections/${id}/review`, { decision, comment });
      }
    },
    onSuccess: (_result, variables) => {
      toast.success(
        variables.decision === "approve" ? "Approved" : "Rejected",
        variables.kind === "leave"
          ? "Their balance and attendance have been updated."
          : "The day has been recalculated."
      );
      setReviewing(null);
      queryClient.invalidateQueries({ queryKey: ["approvals"] });
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
    },
    onError: (error) => toast.fromError(error, "Could not record that decision."),
  });

  const tabs = [
    { key: "leave", label: "Leave", count: leave.data?.length || 0 },
    { key: "corrections", label: "Attendance corrections", count: corrections.data?.length || 0 },
  ];

  const total = (leave.data?.length || 0) + (corrections.data?.length || 0);

  return (
    <>
      <PageHeader
        title="Approvals"
        description={
          total > 0
            ? `${total} ${total === 1 ? "request is" : "requests are"} waiting on you.`
            : "Nothing is waiting on you right now."
        }
      />

      <Tabs items={tabs} active={tab} onChange={setTab} className="mb-5" />

      {tab === "leave" && (
        <Card padded={false}>
          {leave.isLoading ? (
            <div className="space-y-2 p-5">
              {[0, 1, 2].map((index) => (
                <div key={index} className="skeleton h-16" />
              ))}
            </div>
          ) : !leave.data?.length ? (
            <EmptyState
              icon={<ClipboardCheck className="h-5 w-5" />}
              title="No leave waiting"
              description="Requests appear here the moment someone applies."
            />
          ) : (
            <ul className="divide-y">
              {leave.data.map((request) => {
                const employee = typeof request.employeeId === "object" ? request.employeeId : null;
                const type = typeof request.leaveTypeId === "object" ? request.leaveTypeId : null;
                const name = employee
                  ? [employee.personal?.firstName, employee.personal?.lastName]
                      .filter(Boolean)
                      .join(" ")
                  : "Unknown";

                return (
                  <li key={request.id} className="flex flex-wrap items-start gap-4 p-4">
                    <PersonCell name={name} code={employee?.employeeCode} size="md" />

                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-medium text-[var(--text)]">
                        <span
                          className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
                          style={{ background: type?.colour || "var(--border-strong)" }}
                          aria-hidden
                        />
                        {type?.name || "Leave"} · {request.leaveDays}{" "}
                        {request.leaveDays === 1 ? "day" : "days"}
                      </p>
                      <p className="text-[12.5px] text-[var(--text-muted)]">
                        {formatDate(request.fromDate, { locale })}
                        {request.fromDate !== request.toDate &&
                          ` → ${formatDate(request.toDate, { locale })}`}
                        {" · applied "}
                        {formatRelative(request.createdAt)}
                      </p>
                      <p className="mt-1 text-[13px] text-[var(--text)]">{request.reason}</p>

                      {request.calculation?.breakdown && request.calendarDays !== request.leaveDays && (
                        <p className="mt-1 text-[12px] text-[var(--text-subtle)]">
                          {request.calendarDays} calendar days, {request.leaveDays} deducted —{" "}
                          {request.calculation.breakdown.find((entry) =>
                            entry.rule.includes("days_off") || entry.rule.includes("sandwich")
                          )?.detail || "days off excluded"}
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        icon={<Check className="h-3.5 w-3.5" />}
                        onClick={() =>
                          setReviewing({
                            kind: "leave",
                            id: request.id,
                            decision: "approve",
                            label: `${name} · ${type?.name || "Leave"}`,
                          })
                        }
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        icon={<X className="h-3.5 w-3.5" />}
                        onClick={() =>
                          setReviewing({
                            kind: "leave",
                            id: request.id,
                            decision: "reject",
                            label: `${name} · ${type?.name || "Leave"}`,
                          })
                        }
                      >
                        Reject
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {tab === "corrections" && (
        <Card padded={false}>
          {corrections.isLoading ? (
            <div className="space-y-2 p-5">
              {[0, 1, 2].map((index) => (
                <div key={index} className="skeleton h-16" />
              ))}
            </div>
          ) : !corrections.data?.length ? (
            <EmptyState
              icon={<Clock className="h-5 w-5" />}
              title="No corrections waiting"
              description="When someone forgets to punch, their request lands here."
            />
          ) : (
            <ul className="divide-y">
              {corrections.data.map((correction) => {
                const employee =
                  typeof correction.employeeId === "object" ? correction.employeeId : null;
                const name = employee
                  ? [employee.personal?.firstName, employee.personal?.lastName]
                      .filter(Boolean)
                      .join(" ")
                  : "Unknown";

                return (
                  <li key={correction.id} className="flex flex-wrap items-start gap-4 p-4">
                    <PersonCell name={name} code={employee?.employeeCode} size="md" />

                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-medium text-[var(--text)]">
                        {humanise(correction.type)} · {formatDate(correction.date, { locale })}
                      </p>
                      <p className="text-[12.5px] text-[var(--text-muted)]">
                        Requested{" "}
                        {[
                          correction.requested?.checkIn && `in at ${correction.requested.checkIn}`,
                          correction.requested?.checkOut && `out at ${correction.requested.checkOut}`,
                          correction.requested?.status && humanise(correction.requested.status),
                        ]
                          .filter(Boolean)
                          .join(", ") || "a change"}
                        {" · raised "}
                        {formatRelative(correction.createdAt)}
                      </p>
                      <p className="mt-1 text-[13px] text-[var(--text)]">{correction.reason}</p>
                    </div>

                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        icon={<Check className="h-3.5 w-3.5" />}
                        onClick={() =>
                          setReviewing({
                            kind: "correction",
                            id: correction.id,
                            decision: "approve",
                            label: `${name} · ${formatDate(correction.date, { locale })}`,
                          })
                        }
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        icon={<X className="h-3.5 w-3.5" />}
                        onClick={() =>
                          setReviewing({
                            kind: "correction",
                            id: correction.id,
                            decision: "reject",
                            label: `${name} · ${formatDate(correction.date, { locale })}`,
                          })
                        }
                      >
                        Reject
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {reviewing && (
        <DecisionDialog
          reviewing={reviewing}
          loading={decide.isPending}
          onClose={() => setReviewing(null)}
          onConfirm={(comment) =>
            decide.mutate({
              kind: reviewing.kind,
              id: reviewing.id,
              decision: reviewing.decision,
              comment,
            })
          }
        />
      )}
    </>
  );
}

function DecisionDialog({
  reviewing,
  loading,
  onClose,
  onConfirm,
}: {
  reviewing: { kind: string; decision: "approve" | "reject"; label: string };
  loading: boolean;
  onClose: () => void;
  onConfirm: (comment: string) => void;
}) {
  const [comment, setComment] = useState("");
  const rejecting = reviewing.decision === "reject";

  return (
    <Modal
      open
      onClose={onClose}
      title={rejecting ? "Reject this request" : "Approve this request"}
      description={reviewing.label}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={rejecting ? "danger" : "primary"}
            loading={loading}
            disabled={rejecting && !comment.trim()}
            onClick={() => onConfirm(comment)}
          >
            {rejecting ? "Reject" : "Approve"}
          </Button>
        </>
      }
    >
      <Textarea
        label={rejecting ? "Reason for rejecting" : "Comment (optional)"}
        required={rejecting}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        placeholder={
          rejecting ? "The employee sees this, so be clear" : "Anything you want on the record"
        }
        rows={3}
        autoFocus
      />
    </Modal>
  );
}
