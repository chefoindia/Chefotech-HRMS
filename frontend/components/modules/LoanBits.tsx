"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatMoney, humanise } from "@/lib/format";
import { Badge, Button, Callout, FieldGrid, Input, Modal, Select, StatusBadge, Textarea, useToast } from "@/components/ui";
import { periodLabel, type Loan, type LoanSchedulePreview } from "@/lib/moduleTypes";

const STATUS: Record<string, string> = { requested: "pending", approved: "approved", active: "processing", closed: "completed", rejected: "rejected", cancelled: "cancelled" };

export function LoanRow({ loan, currency, locale, showEmployee, actions, onOpen }: { loan: Loan; currency: string; locale: string; showEmployee?: boolean; actions?: React.ReactNode; onOpen?: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3.5">
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <p className="truncate text-[13.5px] font-medium text-[var(--text)]">
          <span className="mr-1.5 font-mono text-[12px] text-[var(--text-subtle)]">#{loan.number}</span>
          {showEmployee && loan.employee?.name ? <span className="text-[var(--text-muted)]">{loan.employee.name} · </span> : null}
          {loan.type === "advance" ? "Salary advance" : "Loan"} of {formatMoney(loan.principal, { currency, locale })}
        </p>
        <p className="truncate text-[12.5px] text-[var(--text-muted)]">
          {loan.instalments} × {formatMoney(loan.instalmentAmount, { currency, locale })} from {periodLabel(loan.startPeriod)}
          {loan.interestRatePercent ? ` · ${loan.interestRatePercent}% p.a.` : " · interest-free"}
          {loan.purpose ? ` · ${loan.purpose}` : ""}
        </p>
      </button>
      {loan.status === "active" && (
        <div className="text-right">
          <p className="text-[13.5px] font-semibold tabular-nums text-[var(--text)]">{formatMoney(loan.outstanding, { currency, locale })}</p>
          <p className="text-[11.5px] text-[var(--text-subtle)]">outstanding · {loan.instalmentsRemaining} left</p>
        </div>
      )}
      <StatusBadge status={STATUS[loan.status] || loan.status} label={humanise(loan.status)} />
      {actions}
    </li>
  );
}

/** Ask for a loan or advance, with the schedule shown before sending. */
export function LoanRequestDialog({ employeeId, onClose, currency, locale }: { employeeId?: string; onClose: () => void; currency: string; locale: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ type: "loan", principal: "", instalments: "6", interestRatePercent: "0", startPeriod: "", purpose: "" });
  const [preview, setPreview] = useState<LoanSchedulePreview | null>(null);

  const { data: limits } = useQuery({ queryKey: ["loans", "limits"], queryFn: async () => (await api.get<{ maxAmount: number; maxInstalments: number; maxActive: number }>("/loans/limits")).data, staleTime: 10 * 60_000 });

  useEffect(() => {
    const principal = Number(form.principal);
    const instalments = Number(form.instalments);
    if (!principal || !instalments) {
      setPreview(null);
      return;
    }
    const handle = setTimeout(() => {
      api
        .post<LoanSchedulePreview>("/loans/preview", { principal, instalments, interestRatePercent: Number(form.interestRatePercent) || 0, startPeriod: form.startPeriod || undefined })
        .then(({ data }) => setPreview(data))
        .catch(() => setPreview(null));
    }, 300);
    return () => clearTimeout(handle);
  }, [form.principal, form.instalments, form.interestRatePercent, form.startPeriod]);

  const submit = useMutation({
    mutationFn: async () => {
      const body = { type: form.type, principal: Number(form.principal), instalments: Number(form.instalments), interestRatePercent: Number(form.interestRatePercent) || 0, startPeriod: form.startPeriod || undefined, purpose: form.purpose };
      if (employeeId) await api.post(`/loans/employee/${employeeId}`, body);
      else await api.post("/loans", body);
    },
    onSuccess: () => {
      toast.success(employeeId ? "Loan recorded" : "Request sent", employeeId ? "It is approved; disburse it when the money goes out." : "You will be told when it is decided.");
      queryClient.invalidateQueries({ queryKey: ["loans"] });
      onClose();
    },
    onError: (error) => toast.fromError(error, "Could not send the request."),
  });

  return (
    <Modal open onClose={onClose} title={employeeId ? "Record a loan or advance" : "Ask for a loan or advance"} size="md" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={submit.isPending} disabled={!Number(form.principal) || !Number(form.instalments)} onClick={() => submit.mutate()}>{employeeId ? "Record" : "Send request"}</Button></>}>
      <div className="space-y-4">
        <FieldGrid columns={2}>
          <Select label="Kind" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} options={[{ value: "loan", label: "Loan" }, { value: "advance", label: "Salary advance" }]} />
          <Input label="Amount" type="number" min={1} max={limits?.maxAmount || undefined} value={form.principal} onChange={(e) => setForm({ ...form, principal: e.target.value })} hint={limits?.maxAmount ? `Up to ${formatMoney(limits.maxAmount, { currency, locale })}` : undefined} required />
          <Input label="Instalments" type="number" min={1} max={limits?.maxInstalments || 120} value={form.instalments} onChange={(e) => setForm({ ...form, instalments: e.target.value })} hint={limits ? `Up to ${limits.maxInstalments}` : undefined} />
          <Input label="First deduction from" type="month" value={form.startPeriod} onChange={(e) => setForm({ ...form, startPeriod: e.target.value })} hint="Blank starts next month." />
          {employeeId && <Input label="Interest (% per year)" type="number" min={0} max={100} value={form.interestRatePercent} onChange={(e) => setForm({ ...form, interestRatePercent: e.target.value })} />}
        </FieldGrid>
        <Textarea label="Purpose" rows={2} value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="e.g. Medical expenses, house deposit" />
        {preview && (
          <Callout tone="info" title={`${preview.rows.length} deductions of about ${formatMoney(preview.instalmentAmount, { currency, locale })}`}>
            {periodLabel(preview.rows[0]?.periodKey)} to {periodLabel(preview.rows[preview.rows.length - 1]?.periodKey)} · total {formatMoney(preview.totalRepayable, { currency, locale })}
            {preview.interest ? ` including ${formatMoney(preview.interest, { currency, locale })} interest` : ""}.
          </Callout>
        )}
      </div>
    </Modal>
  );
}

export function LoanScheduleTable({ loan, currency, locale }: { loan: Loan; currency: string; locale: string }) {
  if (!loan.schedule?.length) return <p className="text-[12.5px] text-[var(--text-muted)]">The schedule is created when the loan is disbursed.</p>;
  return (
    <table className="w-full text-[12.5px]">
      <thead className="text-left text-[11px] uppercase tracking-wide text-[var(--text-subtle)]">
        <tr>
          <th className="py-1">Period</th>
          <th className="py-1 text-right">Amount</th>
          <th className="py-1 text-right">Status</th>
        </tr>
      </thead>
      <tbody className="divide-y">
        {loan.schedule.map((s) => (
          <tr key={s.id}>
            <td className="py-1.5">{periodLabel(s.periodKey)}</td>
            <td className="py-1.5 text-right tabular-nums">{formatMoney(s.amount, { currency, locale })}</td>
            <td className="py-1.5 text-right">
              <Badge tone={s.status === "applied" ? "success" : s.status === "cancelled" ? "neutral" : "info"}>{s.status === "applied" ? "Deducted" : humanise(s.status)}</Badge>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
