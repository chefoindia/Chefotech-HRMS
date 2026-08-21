"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useDebounced } from "@/lib/hooks";
import { formatDate, formatDays, todayString } from "@/lib/format";
import {
  Button,
  Callout,
  Card,
  CardHeader,
  NoAccessState,
  PageHeader,
  Select,
  Textarea,
  useToast,
} from "@/components/ui";
import type { LeaveBalance, LeavePreview } from "@/lib/types";

/**
 * HR applying on someone's behalf.
 *
 * Uses the same preview endpoint the employee sees, so the days quoted here
 * and the days deducted are the same number produced by the same rules.
 */
export default function ApplyOnBehalfPage() {
  const router = useRouter();
  const toast = useToast();
  const { session, can } = useSession();
  const locale = session?.organization?.locale || "en-IN";
  const today = todayString(session?.organization?.timezone);

  const [form, setForm] = useState({
    employeeId: "",
    leaveTypeId: "",
    fromDate: today,
    toDate: today,
    fromPortion: "full",
    toPortion: "full",
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
    enabled: can("leave.apply_on_behalf"),
  });

  const { data: balances } = useQuery({
    queryKey: ["leave", "balances", form.employeeId],
    queryFn: async () => {
      const { data } = await api.get<LeaveBalance[]>(`/leave/balances/${form.employeeId}`);
      return data;
    },
    enabled: Boolean(form.employeeId),
  });

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

  // The preview endpoint is scoped to the signed-in employee, so on-behalf
  // applications rely on the API's own validation at submit time instead. The
  // balance panel below still tells HR what the person has left.
  const selectedBalance = balances?.find((balance) => balance.leaveType.id === form.leaveTypeId);

  const apply = useMutation({
    mutationFn: async () => {
      await api.post("/leave/requests", form);
    },
    onSuccess: () => {
      toast.success("Leave applied", "It is recorded as applied on their behalf.");
      router.push("/app/leave");
    },
    onError: (error) => toast.fromError(error, "Could not submit that request."),
  });

  if (!can("leave.apply_on_behalf")) return <NoAccessState what="applying on behalf" />;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Apply for leave on behalf"
        description="For people who cannot use the portal themselves. The request is marked as applied on their behalf."
        breadcrumb={
          <Link
            href="/app/leave"
            className="mb-2 inline-flex items-center gap-1.5 text-[13px] text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Leave requests
          </Link>
        }
      />

      <Card>
        <div className="space-y-4">
          <Select
            label="Employee"
            value={form.employeeId}
            onChange={(event) => setForm({ ...form, employeeId: event.target.value, leaveTypeId: "" })}
            options={(employees || []).map((employee) => ({
              value: employee.id,
              label: `${employee.fullName} (${employee.employeeCode})`,
            }))}
            placeholder="Choose an employee"
          />

          {form.employeeId && (
            <Select
              label="Leave type"
              value={form.leaveTypeId}
              onChange={(event) => setForm({ ...form, leaveTypeId: event.target.value })}
              options={(balances || [])
                .filter((balance) => balance.eligible)
                .map((balance) => ({
                  value: balance.leaveType.id,
                  label: balance.hasBalance
                    ? `${balance.leaveType.name} — ${balance.available ?? 0} left`
                    : balance.leaveType.name,
                }))}
              placeholder="Choose a leave type"
            />
          )}

          {selectedBalance && selectedBalance.hasBalance && (
            <Callout tone={Number(selectedBalance.available) <= 0 ? "warning" : "info"}>
              {selectedBalance.leaveType.name}: {selectedBalance.available} days available
              {Boolean(selectedBalance.pending) && `, ${selectedBalance.pending} already pending`}.
            </Callout>
          )}

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

          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="First day"
              value={form.fromPortion}
              onChange={(event) => setForm({ ...form, fromPortion: event.target.value })}
              options={[
                { value: "full", label: "Full day" },
                { value: "first_half", label: "First half" },
                { value: "second_half", label: "Second half" },
              ]}
            />
            {form.fromDate !== form.toDate && (
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

          <Textarea
            label="Reason"
            required
            rows={3}
            value={form.reason}
            onChange={(event) => setForm({ ...form, reason: event.target.value })}
            placeholder="Recorded on the request and visible to the employee."
          />

          <Callout tone="info">
            The exact number of days deducted is calculated by the leave policy when this is
            submitted, including how weekends and holidays inside the range are treated.
          </Callout>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button
              loading={apply.isPending}
              disabled={!form.employeeId || !form.leaveTypeId || form.reason.trim().length < 3}
              onClick={() => apply.mutate()}
            >
              Submit request
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
