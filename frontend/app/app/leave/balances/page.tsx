"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Scale } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useReferenceData, toOptions } from "@/lib/hooks";
import {
  Button,
  Card,
  EmptyState,
  FilterSelect,
  Input,
  Modal,
  NoAccessState,
  PageHeader,
  Select,
  Textarea,
  useToast,
} from "@/components/ui";
import { cn } from "@/lib/utils";

interface BalanceRow {
  employeeCode: string;
  name: string;
  leaveType: string;
  opening: number;
  allocated: number;
  carriedForward: number;
  used: number;
  pending: number;
  available: number;
}

export default function LeaveBalancesPage() {
  const { session, can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const locale = session?.organization?.locale || "en-IN";

  const [departmentId, setDepartmentId] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [adjusting, setAdjusting] = useState(false);

  const reference = useReferenceData(can("leave.view"));

  const { data, isLoading } = useQuery({
    queryKey: ["leave", "balances", year, departmentId],
    queryFn: async () => {
      const { data: payload } = await api.get<{ rows: BalanceRow[]; total: number }>(
        "/reports/leave_balances/run",
        { query: { year, departmentId: departmentId || undefined, limit: 1000 } }
      );
      return payload;
    },
    enabled: can("leave.view"),
  });

  if (!can("leave.view")) return <NoAccessState what="leave balances" />;

  const exportBalances = async () => {
    try {
      await api.download("/reports/leave_balances/run", {
        year,
        departmentId: departmentId || undefined,
        format: "xlsx",
      });
      toast.success("Export started");
    } catch (error) {
      toast.fromError(error, "Could not export balances.");
    }
  };

  return (
    <>
      <PageHeader
        title="Leave balances"
        description="Where every balance stands, and how it got there — opening, allocated, carried, used."
        actions={
          <>
            <FilterSelect
              value={departmentId}
              onChange={setDepartmentId}
              options={toOptions(reference.departments)}
              placeholder="All departments"
            />
            <Select
              value={String(year)}
              onChange={(event) => setYear(Number(event.target.value))}
              options={[0, 1, 2].map((offset) => {
                const value = new Date().getFullYear() - offset;
                return { value, label: String(value) };
              })}
              className="h-9 w-auto py-0"
            />
            {can("leave.adjust_balance") && (
              <Button variant="outline" onClick={() => setAdjusting(true)}>
                Adjust a balance
              </Button>
            )}
            {can("leave.export") && (
              <Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={exportBalances}>
                Export
              </Button>
            )}
          </>
        }
      />

      <Card padded={false}>
        {isLoading ? (
          <div className="space-y-2 p-5">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="skeleton h-8" />
            ))}
          </div>
        ) : !data?.rows.length ? (
          <EmptyState
            icon={<Scale className="h-6 w-6" />}
            title="No balances yet"
            description="Balances appear once employees have a leave policy assigned."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b bg-[var(--surface-muted)]">
                  {["Employee", "Leave type", "Opening", "Allocated", "Carried", "Used", "Pending", "Available"].map(
                    (header, index) => (
                      <th
                        key={header}
                        className={cn(
                          "px-3 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--text-muted)]",
                          index < 2 ? "text-left" : "text-right"
                        )}
                      >
                        {header}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, index) => (
                  <tr key={`${row.employeeCode}-${row.leaveType}-${index}`} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      <p className="font-medium text-[var(--text)]">{row.name}</p>
                      <p className="font-mono text-[11.5px] text-[var(--text-muted)]">
                        {row.employeeCode}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-[var(--text-muted)]">{row.leaveType}</td>
                    <td className="tabular px-3 py-2 text-right">{row.opening || "—"}</td>
                    <td className="tabular px-3 py-2 text-right">{row.allocated}</td>
                    <td className="tabular px-3 py-2 text-right">{row.carriedForward || "—"}</td>
                    <td className="tabular px-3 py-2 text-right">{row.used}</td>
                    <td className="tabular px-3 py-2 text-right text-[var(--warning)]">
                      {row.pending || "—"}
                    </td>
                    <td
                      className={cn(
                        "tabular px-3 py-2 text-right font-semibold",
                        row.available < 0 && "text-[var(--danger)]"
                      )}
                    >
                      {row.available}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {adjusting && (
        <AdjustDialog
          onClose={() => setAdjusting(false)}
          onDone={() => {
            setAdjusting(false);
            queryClient.invalidateQueries({ queryKey: ["leave", "balances"] });
          }}
        />
      )}
    </>
  );
}

function AdjustDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({ employeeId: "", leaveTypeId: "", days: 0, note: "" });

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

  const { data: leaveTypes } = useQuery({
    queryKey: ["leave-types"],
    queryFn: async () => {
      const { data } = await api.get<Array<{ id: string; name: string }>>("/leave/types");
      return data;
    },
  });

  const adjust = useMutation({
    mutationFn: async () => {
      await api.post(`/leave/balances/${form.employeeId}/adjust`, {
        leaveTypeId: form.leaveTypeId,
        days: form.days,
        note: form.note,
      });
    },
    onSuccess: () => {
      toast.success("Balance adjusted", "The change is recorded in the balance history and the audit trail.");
      onDone();
    },
    onError: (error) => toast.fromError(error, "Could not adjust that balance."),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Adjust a leave balance"
      description="Use this for corrections. Every adjustment is audited."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={adjust.isPending}
            disabled={!form.employeeId || !form.leaveTypeId || !form.days || form.note.trim().length < 3}
            onClick={() => adjust.mutate()}
          >
            Apply adjustment
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Select
          label="Employee"
          value={form.employeeId}
          onChange={(event) => setForm({ ...form, employeeId: event.target.value })}
          options={(employees || []).map((employee) => ({
            value: employee.id,
            label: `${employee.fullName} (${employee.employeeCode})`,
          }))}
          placeholder="Choose an employee"
        />

        <Select
          label="Leave type"
          value={form.leaveTypeId}
          onChange={(event) => setForm({ ...form, leaveTypeId: event.target.value })}
          options={(leaveTypes || []).map((type) => ({ value: type.id, label: type.name }))}
          placeholder="Choose a leave type"
        />

        <Input
          label="Days"
          type="number"
          step="0.5"
          value={form.days}
          onChange={(event) => setForm({ ...form, days: Number(event.target.value) })}
          hint="Positive adds days, negative removes them."
        />

        <Textarea
          label="Reason"
          required
          rows={2}
          value={form.note}
          onChange={(event) => setForm({ ...form, note: event.target.value })}
          placeholder="Why is this being adjusted?"
        />
      </div>
    </Modal>
  );
}
