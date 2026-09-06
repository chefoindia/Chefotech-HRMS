"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, Receipt } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useListQuery, useListState } from "@/lib/hooks";
import { formatMoney } from "@/lib/format";
import { Button, Card, EmptyState, FilterSelect, Input, Modal, NoAccessState, PageHeader, Select, StatCard, TableToolbar, Tabs, useToast } from "@/components/ui";
import { DecisionDialog } from "@/components/modules/DecisionDialog";
import { ExpenseRow } from "@/components/modules/ExpenseRow";
import type { ExpenseClaim } from "@/lib/moduleTypes";

/** Expense claims for approvers and finance. */
export default function ExpensesAdminPage() {
  const { session, can, canAny } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const currency = session?.organization?.currency || "INR";
  const locale = session?.organization?.locale || "en-IN";
  const [tab, setTab] = useState(can("expense.approve") ? "to_approve" : "all");
  const state = useListState();
  const [deciding, setDeciding] = useState<{ claim: ExpenseClaim; decision: "approve" | "reject" } | null>(null);
  const [paying, setPaying] = useState<ExpenseClaim | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: summary } = useQuery({
    queryKey: ["expenses", "summary"],
    queryFn: async () => (await api.get<{ awaitingApproval: number; awaitingApprovalTotal: number; awaitingPayment: number; awaitingPaymentTotal: number }>("/expenses/summary")).data,
    enabled: canAny("expense.view", "expense.reimburse"),
  });

  const { items, total, limit, isLoading, error } = useListQuery<ExpenseClaim>("expenses", "/expenses", state, {
    limit: 30,
    extraQuery: { scope: tab === "to_pay" ? "all" : tab, status: tab === "to_pay" ? "approved" : state.filters.status },
    enabled: canAny("expense.approve", "expense.view", "expense.reimburse"),
  });

  const decide = useMutation({
    mutationFn: ({ id, decision, comment, approvedTotal }: { id: string; decision: "approve" | "reject"; comment: string; approvedTotal?: number | null }) => api.post(`/expenses/${id}/decide`, { decision, comment, approvedTotal }),
    onSuccess: (_, v) => {
      toast.success(v.decision === "approve" ? "Approved" : "Rejected", "The employee has been told.");
      setDeciding(null);
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (error) => toast.fromError(error, "Could not record that decision."),
  });

  if (!canAny("expense.approve", "expense.view", "expense.reimburse")) return <NoAccessState what="expense claims" />;

  return (
    <>
      <PageHeader title="Expense claims" description="Approve what your team spent, and pay approved claims through payroll or by transfer." />

      {summary && (
        <div className="mb-5 grid gap-3 sm:grid-cols-2">
          <StatCard label="Awaiting approval" value={formatMoney(summary.awaitingApprovalTotal, { currency, locale })} hint={`${summary.awaitingApproval} claim${summary.awaitingApproval === 1 ? "" : "s"}`} icon={<Receipt className="h-4 w-4" />} tone={summary.awaitingApproval ? "warning" : "default"} onClick={() => setTab("to_approve")} />
          <StatCard label="Approved, awaiting payment" value={formatMoney(summary.awaitingPaymentTotal, { currency, locale })} hint={`${summary.awaitingPayment} claim${summary.awaitingPayment === 1 ? "" : "s"}`} icon={<Banknote className="h-4 w-4" />} tone={summary.awaitingPayment ? "info" : "default"} onClick={() => setTab("to_pay")} />
        </div>
      )}

      <Tabs
        items={[
          ...(can("expense.approve") ? [{ key: "to_approve", label: "Waiting on me" }] : []),
          ...(can("expense.reimburse") ? [{ key: "to_pay", label: "To pay" }] : []),
          ...(can("expense.view") ? [{ key: "all", label: "All claims" }] : []),
        ]}
        active={tab}
        onChange={(key) => {
          setTab(key);
          state.setPage(1);
        }}
        className="mb-4"
      />

      {tab === "all" && (
        <div className="mb-4">
          <TableToolbar filters={<FilterSelect value={state.filters.status || ""} onChange={(v) => state.setFilter("status", v)} placeholder="Any status" options={["draft", "submitted", "approved", "rejected", "reimbursed", "cancelled"].map((s) => ({ value: s, label: s }))} />} activeFilterCount={state.activeFilterCount} onClearFilters={state.clearFilters} />
        </div>
      )}

      {isLoading ? (
        <div className="skeleton h-40" />
      ) : error ? (
        <Card>
          <EmptyState title="Could not load claims" description={(error as Error).message} />
        </Card>
      ) : !items.length ? (
        <Card>
          <EmptyState icon={<Receipt className="h-6 w-6" />} title="Nothing here" description={tab === "to_approve" ? "No claims are waiting on you." : tab === "to_pay" ? "Every approved claim has been paid." : "No claims match."} />
        </Card>
      ) : (
        <Card padded={false}>
          <ul className="divide-y">
            {items.map((claim) => (
              <ExpenseRow
                key={claim.id}
                claim={claim}
                currency={currency}
                locale={locale}
                showEmployee
                expanded={expanded === claim.id}
                onToggle={() => setExpanded(expanded === claim.id ? null : claim.id)}
                actions={
                  claim.status === "submitted" && !claim.viaWorkflow && can("expense.approve") ? (
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => setDeciding({ claim, decision: "reject" })}>
                        Reject
                      </Button>
                      <Button size="sm" onClick={() => setDeciding({ claim, decision: "approve" })}>
                        Approve
                      </Button>
                    </div>
                  ) : claim.status === "approved" && can("expense.reimburse") ? (
                    <Button size="sm" icon={<Banknote className="h-3.5 w-3.5" />} onClick={() => setPaying(claim)}>
                      Pay
                    </Button>
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
        <DecisionDialog
          title={`${deciding.decision === "approve" ? "Approve" : "Reject"} claim #${deciding.claim.number}`}
          decision={deciding.decision}
          loading={decide.isPending}
          amountLabel={deciding.decision === "approve" ? `Amount to approve (claimed ${formatMoney(deciding.claim.total, { currency, locale })})` : undefined}
          amountDefault={deciding.claim.total}
          onClose={() => setDeciding(null)}
          onConfirm={(comment, amount) => decide.mutate({ id: deciding.claim.id, decision: deciding.decision, comment, approvedTotal: amount })}
        >
          <p className="text-[13px] text-[var(--text-muted)]">
            {deciding.claim.employee?.name} · {deciding.claim.title} · {deciding.claim.lines.length} line{deciding.claim.lines.length === 1 ? "" : "s"}
          </p>
        </DecisionDialog>
      )}

      {paying && <ReimburseDialog claim={paying} currency={currency} locale={locale} onClose={() => setPaying(null)} />}
    </>
  );
}

function ReimburseDialog({ claim, currency, locale, onClose }: { claim: ExpenseClaim; currency: string; locale: string; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [method, setMethod] = useState("payroll");
  const [reference, setReference] = useState("");
  const pay = useMutation({
    mutationFn: () => api.post(`/expenses/${claim.id}/reimburse`, { method, reference }),
    onSuccess: () => {
      toast.success("Marked as reimbursed", method === "payroll" ? "It will appear as an earning on the next payroll run." : "The employee has been told.");
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      onClose();
    },
    onError: (error) => toast.fromError(error, "Could not record the payment."),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={`Pay claim #${claim.number}`}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={pay.isPending} onClick={() => pay.mutate()}>Confirm payment</Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[13.5px] text-[var(--text)]">
          <strong>{formatMoney(claim.payable, { currency, locale })}</strong> to {claim.employee?.name}
          {claim.advanceAmount ? ` (after netting the ${formatMoney(claim.advanceAmount, { currency, locale })} advance)` : ""}.
        </p>
        <Select
          label="How"
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          options={[
            { value: "payroll", label: "With the next salary (payroll earning)" },
            { value: "bank_transfer", label: "Bank transfer, already made" },
            { value: "cash", label: "Cash, already paid" },
            { value: "other", label: "Other" },
          ]}
          hint={method === "payroll" ? "Queued as a payroll input; it lands on the next processed run." : "Recorded as paid now."}
        />
        {method !== "payroll" && <Input label="Reference (optional)" placeholder="UTR / voucher number" value={reference} onChange={(e) => setReference(e.target.value)} />}
      </div>
    </Modal>
  );
}
