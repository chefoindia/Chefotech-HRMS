"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, CheckCircle2, Info, Plus, X } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useDebounced } from "@/lib/hooks";
import { formatDate, formatDays, humanise, todayString } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Button,
  Callout,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Modal,
  PageHeader,
  Select,
  StatusBadge,
  Textarea,
  useToast,
} from "@/components/ui";
import type { LeaveBalance, LeavePreview, LeaveRequest } from "@/lib/types";

export default function MyLeavePage() {
  const { session } = useSession();
  const locale = session?.organization?.locale || "en-IN";
  const timezone = session?.organization?.timezone;
  const queryClient = useQueryClient();
  const toast = useToast();

  const [applyOpen, setApplyOpen] = useState(false);
  const [cancelling, setCancelling] = useState<LeaveRequest | null>(null);

  const { data: balances, isLoading: balancesLoading } = useQuery({
    queryKey: ["me", "leave-balances"],
    queryFn: async () => {
      const { data } = await api.get<LeaveBalance[]>("/leave/me/balances");
      return data;
    },
  });

  const { data: requests, isLoading: requestsLoading } = useQuery({
    queryKey: ["me", "leave-requests"],
    queryFn: async () => {
      const { data } = await api.get<LeaveRequest[]>("/leave/requests", {
        query: { employeeId: session?.employeeId || undefined, limit: 30 },
      });
      return data;
    },
    enabled: Boolean(session?.employeeId),
  });

  const cancel = useMutation({
    mutationFn: async (id: string) => {
      await api.post(`/leave/requests/${id}/cancel`, { reason: "Cancelled by employee" });
    },
    onSuccess: () => {
      toast.success("Leave cancelled", "The days have been returned to your balance.");
      setCancelling(null);
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (error) => toast.fromError(error, "Could not cancel that request."),
  });

  const eligible = (balances || []).filter((balance) => balance.eligible);

  return (
    <>
      <PageHeader
        title="My leave"
        description="Your balance, your requests, and how many days each one actually costs."
        actions={
          <Button onClick={() => setApplyOpen(true)} icon={<Plus className="h-4 w-4" />}>
            Apply for leave
          </Button>
        }
      />

      {/* ── Balances ─────────────────────────────────────────────────── */}
      {balancesLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="skeleton h-32" />
          ))}
        </div>
      ) : !eligible.length ? (
        <Card>
          <EmptyState
            icon={<CalendarDays className="h-5 w-5" />}
            title="No leave types available"
            description="Ask HR to assign a leave policy to your profile."
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {eligible
            .filter((balance) => balance.hasBalance)
            .map((balance) => (
              <Card key={balance.leaveType.id} className="p-4">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: balance.leaveType.colour }}
                    aria-hidden
                  />
                  <p className="truncate text-[13px] font-medium text-[var(--text)]">
                    {balance.leaveType.name}
                  </p>
                </div>

                <p className="tabular mt-2 text-2xl font-semibold text-[var(--text)]">
                  {balance.available ?? 0}
                </p>
                <p className="text-[12px] text-[var(--text-muted)]">days available</p>

                <dl className="mt-3 space-y-0.5 border-t pt-2 text-[12px]">
                  <div className="flex justify-between">
                    <dt className="text-[var(--text-muted)]">Allocated</dt>
                    <dd className="tabular">{balance.allocated ?? 0}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-[var(--text-muted)]">Used</dt>
                    <dd className="tabular">{balance.used ?? 0}</dd>
                  </div>
                  {Boolean(balance.pending) && (
                    <div className="flex justify-between text-[var(--warning)]">
                      <dt>Pending</dt>
                      <dd className="tabular">{balance.pending}</dd>
                    </div>
                  )}
                </dl>
              </Card>
            ))}
        </div>
      )}

      {/* ── Requests ─────────────────────────────────────────────────── */}
      <Card className="mt-5" padded={false}>
        <div className="p-5 pb-0">
          <CardHeader title="Your requests" description="Most recent first." />
        </div>

        {requestsLoading ? (
          <div className="space-y-2 p-5">
            {[0, 1, 2].map((index) => (
              <div key={index} className="skeleton h-12" />
            ))}
          </div>
        ) : !requests?.length ? (
          <EmptyState
            icon={<CalendarDays className="h-5 w-5" />}
            title="You have not applied for leave yet"
            description="When you do, you will see the status here."
          />
        ) : (
          <ul className="divide-y">
            {requests.map((request) => {
              const type = typeof request.leaveTypeId === "object" ? request.leaveTypeId : null;
              const canCancel = ["pending", "approved"].includes(request.status);

              return (
                <li key={request.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: type?.colour || "var(--border-strong)" }}
                    aria-hidden
                  />

                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-medium text-[var(--text)]">
                      {type?.name || "Leave"} · {formatDays(request.leaveDays)}
                    </p>
                    <p className="text-[12.5px] text-[var(--text-muted)]">
                      {formatDate(request.fromDate, { locale })}
                      {request.fromDate !== request.toDate &&
                        ` → ${formatDate(request.toDate, { locale })}`}
                      {" · "}
                      {request.reason}
                    </p>
                    {request.status === "rejected" && request.rejectionReason && (
                      <p className="mt-0.5 text-[12.5px] text-[var(--danger)]">
                        Reason: {request.rejectionReason}
                      </p>
                    )}
                  </div>

                  <StatusBadge status={request.status} />

                  {canCancel && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<X className="h-3.5 w-3.5" />}
                      onClick={() => setCancelling(request)}
                    >
                      Cancel
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <ApplyDialog
        open={applyOpen}
        onClose={() => setApplyOpen(false)}
        balances={eligible}
        locale={locale}
        timezone={timezone}
        onDone={() => {
          setApplyOpen(false);
          queryClient.invalidateQueries({ queryKey: ["me"] });
        }}
      />

      <ConfirmDialog
        open={Boolean(cancelling)}
        onClose={() => setCancelling(null)}
        onConfirm={() => {
          if (cancelling) cancel.mutate(cancelling.id);
        }}
        loading={cancel.isPending}
        tone="danger"
        title="Cancel this leave request?"
        confirmLabel="Cancel leave"
        cancelLabel="Keep it"
        message={
          cancelling ? (
            <>
              {formatDays(cancelling.leaveDays)} from {formatDate(cancelling.fromDate, { locale })}{" "}
              will be returned to your balance.
            </>
          ) : null
        }
      />
    </>
  );
}

/**
 * Apply for leave.
 *
 * The cost is previewed live, before submitting. That preview is the whole
 * point: an employee picking Friday to Monday should be told, right there,
 * whether the weekend in the middle is being deducted — rather than finding
 * out when their balance drops by four days instead of two.
 */
function ApplyDialog({
  open,
  onClose,
  balances,
  locale,
  timezone,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  balances: LeaveBalance[];
  locale: string;
  timezone?: string;
  onDone: () => void;
}) {
  const toast = useToast();
  const today = todayString(timezone);

  const [form, setForm] = useState({
    leaveTypeId: "",
    fromDate: today,
    toDate: today,
    fromPortion: "full",
    toPortion: "full",
    reason: "",
  });

  useEffect(() => {
    if (open && balances.length && !form.leaveTypeId) {
      setForm((current) => ({ ...current, leaveTypeId: balances[0].leaveType.id }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, balances]);

  const previewInput = useDebounced(
    useMemo(
      () => ({
        leaveTypeId: form.leaveTypeId,
        fromDate: form.fromDate,
        toDate: form.toDate,
        fromPortion: form.fromPortion,
        toPortion: form.toPortion,
      }),
      [form.leaveTypeId, form.fromDate, form.toDate, form.fromPortion, form.toPortion]
    ),
    400
  );

  const { data: preview, isFetching: previewing } = useQuery({
    queryKey: ["leave-preview", previewInput],
    queryFn: async () => {
      const { data } = await api.post<LeavePreview>("/leave/me/preview", previewInput);
      return data;
    },
    enabled:
      open &&
      Boolean(previewInput.leaveTypeId) &&
      Boolean(previewInput.fromDate) &&
      previewInput.fromDate <= previewInput.toDate,
    retry: false,
  });

  const apply = useMutation({
    mutationFn: async () => {
      await api.post("/leave/me/apply", form);
    },
    onSuccess: () => {
      toast.success("Leave applied", "Your manager has been notified.");
      setForm({
        leaveTypeId: balances[0]?.leaveType.id || "",
        fromDate: today,
        toDate: today,
        fromPortion: "full",
        toPortion: "full",
        reason: "",
      });
      onDone();
    },
    onError: (error) => toast.fromError(error, "Could not submit your request."),
  });

  const selected = balances.find((balance) => balance.leaveType.id === form.leaveTypeId);
  const singleDay = form.fromDate === form.toDate;
  const invalidRange = form.fromDate > form.toDate;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Apply for leave"
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => apply.mutate()}
            loading={apply.isPending}
            disabled={!preview?.canApply || !form.reason.trim() || invalidRange}
          >
            Submit request
          </Button>
        </>
      }
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <Select
            label="Leave type"
            value={form.leaveTypeId}
            onChange={(event) => setForm({ ...form, leaveTypeId: event.target.value })}
            options={balances.map((balance) => ({
              value: balance.leaveType.id,
              label: balance.hasBalance
                ? `${balance.leaveType.name} — ${balance.available ?? 0} left`
                : balance.leaveType.name,
            }))}
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-[13px] font-medium text-[var(--text)]">From</label>
              <input
                type="date"
                value={form.fromDate}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    fromDate: event.target.value,
                    toDate: current.toDate < event.target.value ? event.target.value : current.toDate,
                  }))
                }
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

          {selected?.leaveType.allowHalfDay && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label={singleDay ? "Portion of the day" : "First day"}
                value={form.fromPortion}
                onChange={(event) => setForm({ ...form, fromPortion: event.target.value })}
                options={[
                  { value: "full", label: "Full day" },
                  { value: "first_half", label: "First half" },
                  { value: "second_half", label: "Second half" },
                ]}
              />
              {!singleDay && (
                <Select
                  label="Last day"
                  value={form.toPortion}
                  onChange={(event) => setForm({ ...form, toPortion: event.target.value })}
                  options={[
                    { value: "full", label: "Full day" },
                    { value: "first_half", label: "First half" },
                  ]}
                />
              )}
            </div>
          )}

          <Textarea
            label="Reason"
            required
            value={form.reason}
            onChange={(event) => setForm({ ...form, reason: event.target.value })}
            placeholder="Your manager sees this"
            rows={3}
          />
        </div>

        {/* ── Live cost preview ─────────────────────────────────────── */}
        <div className="rounded-[var(--radius)] border bg-[var(--surface-muted)] p-4">
          {invalidRange ? (
            <Callout tone="warning">The end date must be on or after the start date.</Callout>
          ) : previewing && !preview ? (
            <div className="space-y-2">
              <div className="skeleton h-8 w-24" />
              <div className="skeleton h-4 w-40" />
              <div className="skeleton h-20" />
            </div>
          ) : !preview ? (
            <p className="text-[13px] text-[var(--text-muted)]">
              Choose a leave type and dates to see how many days will be deducted.
            </p>
          ) : (
            <>
              <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
                This request costs
              </p>
              <p className="tabular mt-1 text-3xl font-semibold text-[var(--text)]">
                {preview.leaveDays}
                <span className="ml-1.5 text-[15px] font-normal text-[var(--text-muted)]">
                  {preview.leaveDays === 1 ? "day" : "days"}
                </span>
              </p>
              <p className="text-[12.5px] text-[var(--text-muted)]">
                across {preview.calendarDays} calendar {preview.calendarDays === 1 ? "day" : "days"}
              </p>

              {preview.balanceAvailable !== null && (
                <p className="mt-2 text-[13px] text-[var(--text)]">
                  Balance after: <span className="tabular font-semibold">{preview.balanceAfter}</span>{" "}
                  <span className="text-[var(--text-muted)]">
                    (from {preview.balanceAvailable})
                  </span>
                </p>
              )}

              <div className="mt-4 border-t pt-3">
                <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
                  How that was worked out
                </p>
                <ul className="space-y-1">
                  {preview.breakdown.map((entry, index) => (
                    <li key={index} className="flex gap-2 text-[12.5px]">
                      <span className="text-[var(--text-muted)]">{entry.detail}</span>
                      <span className="ml-auto shrink-0 font-medium text-[var(--text)]">
                        {entry.effect}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {preview.days.some((day) => day.isHoliday || day.isWeeklyOff) && (
                <div className="mt-3 border-t pt-3">
                  <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
                    Days off inside your dates
                  </p>
                  <ul className="space-y-1">
                    {preview.days
                      .filter((day) => day.isHoliday || day.isWeeklyOff)
                      .map((day) => (
                        <li
                          key={day.date}
                          className={cn(
                            "flex items-center gap-2 text-[12.5px]",
                            day.deductedDays > 0 ? "text-[var(--warning)]" : "text-[var(--success)]"
                          )}
                        >
                          {day.deductedDays > 0 ? (
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          )}
                          <span>{formatDate(day.date, { locale })}</span>
                          <span className="ml-auto text-right text-[var(--text-muted)]">
                            {day.reason}
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
              )}

              {preview.attachmentRequired && (
                <Callout tone="info" className="mt-3" icon={<Info className="h-4 w-4" />}>
                  A supporting document is required for a request of this length. Upload it from
                  the request once submitted.
                </Callout>
              )}

              {preview.problems.length > 0 && (
                <Callout tone="warning" className="mt-3">
                  <ul className="space-y-0.5">
                    {preview.problems.map((problem, index) => (
                      <li key={index}>{problem}</li>
                    ))}
                  </ul>
                </Callout>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
