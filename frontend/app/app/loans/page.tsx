"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HandCoins, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useListQuery, useListState } from "@/lib/hooks";
import { formatDate, formatMoney, humanise } from "@/lib/format";
import { Button, Card, Drawer, EmptyState, FieldGrid, FilterSelect, Input, NoAccessState, PageHeader, Select, TableToolbar, Textarea, useToast } from "@/components/ui";
import { DecisionDialog } from "@/components/modules/DecisionDialog";
import { LoanRequestDialog, LoanRow, LoanScheduleTable } from "@/components/modules/LoanBits";
import { EmployeeMultiPicker } from "@/components/documents/EmployeePicker";
import type { Loan } from "@/lib/moduleTypes";

/** Loans for HR and finance: approve, disburse, record repayments, close. */
export default function LoansAdminPage() {
  const { session, can, canAny } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const currency = session?.organization?.currency || "INR";
  const locale = session?.organization?.locale || "en-IN";
  const state = useListState({ filters: {} });
  const [deciding, setDeciding] = useState<{ loan: Loan; decision: "approve" | "reject" } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [recording, setRecording] = useState<string[] | null>(null);
  const [recordFor, setRecordFor] = useState<string | null>(null);

  const { items, total, limit, isLoading, error } = useListQuery<Loan>("loans", "/loans", state, { limit: 30, extraQuery: { scope: "all" }, enabled: canAny("loan.manage", "loan.approve") });

  const decide = useMutation({
    mutationFn: ({ id, decision, comment }: { id: string; decision: "approve" | "reject"; comment: string }) => api.post(`/loans/${id}/decide`, { decision, comment }),
    onSuccess: (_, v) => {
      toast.success(v.decision === "approve" ? "Approved" : "Rejected");
      setDeciding(null);
      queryClient.invalidateQueries({ queryKey: ["loans"] });
    },
    onError: (error) => toast.fromError(error, "Could not record that decision."),
  });

  if (!canAny("loan.manage", "loan.approve")) return <NoAccessState what="loans" />;

  return (
    <>
      <PageHeader title="Loans and advances" description="Approve requests, record the payout, and let payroll recover the instalments." actions={can("loan.manage") && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setRecording([])}>Record a loan</Button>} />

      <div className="mb-4">
        <TableToolbar filters={<FilterSelect value={state.filters.status || ""} onChange={(v) => state.setFilter("status", v)} placeholder="Any status" options={["requested", "approved", "active", "closed", "rejected", "cancelled"].map((s) => ({ value: s, label: humanise(s) }))} />} activeFilterCount={state.activeFilterCount} onClearFilters={state.clearFilters} />
      </div>

      {isLoading ? (
        <div className="skeleton h-40" />
      ) : error ? (
        <Card><EmptyState title="Could not load loans" description={(error as Error).message} /></Card>
      ) : !items.length ? (
        <Card><EmptyState icon={<HandCoins className="h-6 w-6" />} title="No loans" description="Requests from employees appear here; you can also record a loan directly." /></Card>
      ) : (
        <Card padded={false}>
          <ul className="divide-y">
            {items.map((loan) => (
              <LoanRow
                key={loan.id}
                loan={loan}
                currency={currency}
                locale={locale}
                showEmployee
                onOpen={() => setOpenId(loan.id)}
                actions={
                  loan.status === "requested" && can("loan.approve") ? (
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => setDeciding({ loan, decision: "reject" })}>Reject</Button>
                      <Button size="sm" onClick={() => setDeciding({ loan, decision: "approve" })}>Approve</Button>
                    </div>
                  ) : loan.status === "approved" && can("loan.manage") ? (
                    <Button size="sm" onClick={() => setOpenId(loan.id)}>Disburse</Button>
                  ) : undefined
                }
              />
            ))}
          </ul>
          {total > limit && (
            <div className="flex items-center justify-between border-t px-5 py-3 text-[12.5px] text-[var(--text-muted)]">
              <span>Page {state.page} of {Math.ceil(total / limit)}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={state.page <= 1} onClick={() => state.setPage(state.page - 1)}>Previous</Button>
                <Button variant="outline" size="sm" disabled={state.page * limit >= total} onClick={() => state.setPage(state.page + 1)}>Next</Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {deciding && (
        <DecisionDialog title={`${deciding.decision === "approve" ? "Approve" : "Reject"} loan #${deciding.loan.number}`} decision={deciding.decision} loading={decide.isPending} onClose={() => setDeciding(null)} onConfirm={(comment) => decide.mutate({ id: deciding.loan.id, decision: deciding.decision, comment })}>
          <p className="text-[13px] text-[var(--text-muted)]">
            {deciding.loan.employee?.name} · {formatMoney(deciding.loan.principal, { currency, locale })} over {deciding.loan.instalments} instalments{deciding.loan.purpose ? ` · ${deciding.loan.purpose}` : ""}
          </p>
        </DecisionDialog>
      )}

      {openId && <LoanDrawer loanId={openId} currency={currency} locale={locale} onClose={() => setOpenId(null)} />}

      {recording && !recordFor && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-[var(--radius)] border bg-[var(--surface)] p-5 shadow-xl">
            <h3 className="text-[15px] font-semibold text-[var(--text)]">Which employee?</h3>
            <div className="mt-3"><EmployeeMultiPicker selected={recording} onChange={(ids) => setRecording(ids.slice(-1))} maxHeight="14rem" /></div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRecording(null)}>Cancel</Button>
              <Button disabled={!recording.length} onClick={() => setRecordFor(recording[0])}>Continue</Button>
            </div>
          </div>
        </div>
      )}
      {recordFor && <LoanRequestDialog employeeId={recordFor} currency={currency} locale={locale} onClose={() => { setRecordFor(null); setRecording(null); }} />}
    </>
  );
}

function LoanDrawer({ loanId, currency, locale, onClose }: { loanId: string; currency: string; locale: string; onClose: () => void }) {
  const { can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [disburse, setDisburse] = useState({ via: "bank_transfer", reference: "", disbursedOn: "" });
  const [repay, setRepay] = useState({ amount: "", reference: "" });
  const [closeReason, setCloseReason] = useState("");
  const [mode, setMode] = useState<"none" | "disburse" | "repay" | "close">("none");

  const { data: loan } = useQuery({ queryKey: ["loans", loanId], queryFn: async () => (await api.get<Loan>(`/loans/${loanId}`)).data });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["loans"] });
  const act = useMutation({
    mutationFn: async () => {
      if (mode === "disburse") await api.post(`/loans/${loanId}/disburse`, { via: disburse.via, reference: disburse.reference, disbursedOn: disburse.disbursedOn || null });
      if (mode === "repay") await api.post(`/loans/${loanId}/repayments`, { amount: Number(repay.amount), reference: repay.reference });
      if (mode === "close") await api.post(`/loans/${loanId}/close`, { reason: closeReason });
    },
    onSuccess: () => {
      toast.success(mode === "disburse" ? "Disbursed — instalments scheduled with payroll" : mode === "repay" ? "Repayment recorded" : "Loan closed");
      setMode("none");
      refresh();
    },
    onError: (error) => toast.fromError(error, "Could not do that."),
  });

  return (
    <Drawer open onClose={onClose} title={loan ? `#${loan.number} ${loan.employee?.name || ""}` : "Loan"} width="md" footer={
      loan && can("loan.manage") ? (
        <>
          {loan.status === "approved" && <Button onClick={() => setMode("disburse")}>Disburse</Button>}
          {loan.status === "active" && <Button variant="outline" onClick={() => setMode("repay")}>Record repayment</Button>}
          {["requested", "approved", "active"].includes(loan.status) && <Button variant="outline" onClick={() => setMode("close")}>Close</Button>}
        </>
      ) : undefined
    }>
      {!loan ? (
        <div className="skeleton h-40" />
      ) : (
        <div className="space-y-4 text-[13px]">
          <p>
            {loan.type === "advance" ? "Salary advance" : "Loan"} of <strong>{formatMoney(loan.principal, { currency, locale })}</strong> · {loan.instalments} × {formatMoney(loan.instalmentAmount, { currency, locale })} · {humanise(loan.status)}
          </p>
          {loan.purpose && <p className="text-[var(--text-muted)]">{loan.purpose}</p>}
          {loan.approvedBy && <p className="text-[var(--text-muted)]">Approved by {loan.approvedBy} {loan.approvedAt ? formatDate(loan.approvedAt, { locale }) : ""}{loan.decisionComment ? ` — “${loan.decisionComment}”` : ""}</p>}
          {loan.disbursedOn && <p className="text-[var(--text-muted)]">Paid out {formatDate(loan.disbursedOn, { locale })} by {humanise(loan.disbursedVia || "")}{loan.disbursementReference ? ` (${loan.disbursementReference})` : ""}.</p>}
          {loan.status === "active" && <p>Outstanding <strong>{formatMoney(loan.outstanding, { currency, locale })}</strong> · {loan.instalmentsRemaining} left</p>}
          {loan.manualRepayments.length > 0 && (
            <p className="text-[var(--text-muted)]">Repaid outside payroll: {loan.manualRepayments.map((r) => `${formatMoney(r.amount, { currency, locale })} on ${formatDate(r.on, { locale })}`).join(", ")}</p>
          )}
          <LoanScheduleTable loan={loan} currency={currency} locale={locale} />

          {mode === "disburse" && (
            <div className="space-y-3 rounded-md border p-3">
              <FieldGrid columns={2}>
                <Select label="Paid out by" value={disburse.via} onChange={(e) => setDisburse({ ...disburse, via: e.target.value })} options={[{ value: "bank_transfer", label: "Bank transfer" }, { value: "payroll", label: "Add to next payslip" }, { value: "cash", label: "Cash" }, { value: "other", label: "Other" }]} />
                <Input label="On" type="date" value={disburse.disbursedOn} onChange={(e) => setDisburse({ ...disburse, disbursedOn: e.target.value })} />
              </FieldGrid>
              <Input label="Reference" value={disburse.reference} onChange={(e) => setDisburse({ ...disburse, reference: e.target.value })} />
              <div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={() => setMode("none")}>Cancel</Button><Button size="sm" loading={act.isPending} onClick={() => act.mutate()}>Confirm</Button></div>
            </div>
          )}
          {mode === "repay" && (
            <div className="space-y-3 rounded-md border p-3">
              <FieldGrid columns={2}>
                <Input label="Amount" type="number" min={1} value={repay.amount} onChange={(e) => setRepay({ ...repay, amount: e.target.value })} />
                <Input label="Reference" value={repay.reference} onChange={(e) => setRepay({ ...repay, reference: e.target.value })} />
              </FieldGrid>
              <p className="text-[12px] text-[var(--text-subtle)]">The last scheduled instalments are cancelled to match.</p>
              <div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={() => setMode("none")}>Cancel</Button><Button size="sm" loading={act.isPending} disabled={!Number(repay.amount)} onClick={() => act.mutate()}>Record</Button></div>
            </div>
          )}
          {mode === "close" && (
            <div className="space-y-3 rounded-md border p-3">
              <Textarea label="Reason" rows={2} value={closeReason} onChange={(e) => setCloseReason(e.target.value)} placeholder="Written off / settled at exit / cancelled" />
              <p className="text-[12px] text-[var(--text-subtle)]">Remaining instalments are cancelled. Nothing already deducted is reversed.</p>
              <div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={() => setMode("none")}>Cancel</Button><Button size="sm" variant="danger" loading={act.isPending} onClick={() => act.mutate()}>Close loan</Button></div>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
