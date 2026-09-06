"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Receipt } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatMoney } from "@/lib/format";
import { Button, Card, ConfirmDialog, EmptyState, PageHeader, StatCard, Tabs, useToast } from "@/components/ui";
import { ExpenseForm } from "@/components/modules/ExpenseForm";
import { ExpenseRow } from "@/components/modules/ExpenseRow";
import type { ExpenseClaim } from "@/lib/moduleTypes";

/** My expense claims. */
export default function MyExpensesPage() {
  const { session, can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const currency = session?.organization?.currency || "INR";
  const locale = session?.organization?.locale || "en-IN";
  const [tab, setTab] = useState("active");
  const [editing, setEditing] = useState<ExpenseClaim | null | "new">(null);
  const [withdrawing, setWithdrawing] = useState<ExpenseClaim | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["expenses", "mine"],
    queryFn: async () => (await api.get<ExpenseClaim[]>("/expenses", { query: { scope: "mine", limit: 100 } })).data,
    enabled: Boolean(session?.employeeId),
  });

  const withdraw = useMutation({
    mutationFn: (id: string) => api.post(`/expenses/${id}/withdraw`),
    onSuccess: () => {
      toast.success("Claim withdrawn", "It is back in your drafts.");
      setWithdrawing(null);
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (error) => toast.fromError(error, "Could not withdraw that claim."),
  });

  const rows = data || [];
  const active = rows.filter((c) => ["draft", "submitted", "approved"].includes(c.status));
  const settled = rows.filter((c) => !["draft", "submitted", "approved"].includes(c.status));
  const shown = tab === "active" ? active : settled;
  const awaiting = rows.filter((c) => c.status === "submitted").reduce((s, c) => s + c.total, 0);
  const approvedUnpaid = rows.filter((c) => c.status === "approved").reduce((s, c) => s + c.payable, 0);
  const paidThisYear = rows.filter((c) => c.status === "reimbursed" && new Date(c.createdAt).getFullYear() === new Date().getFullYear()).reduce((s, c) => s + c.payable, 0);

  return (
    <>
      <PageHeader
        title="My expenses"
        description="Claim what you spent for work. Approved claims are paid with your salary or by transfer."
        actions={
          can("expense.submit") && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing("new")}>
              New claim
            </Button>
          )
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Awaiting approval" value={formatMoney(awaiting, { currency, locale })} />
        <StatCard label="Approved, not yet paid" value={formatMoney(approvedUnpaid, { currency, locale })} tone={approvedUnpaid ? "info" : "default"} />
        <StatCard label="Reimbursed this year" value={formatMoney(paidThisYear, { currency, locale })} tone="success" />
      </div>

      <Tabs items={[{ key: "active", label: "In progress", count: active.length }, { key: "settled", label: "Settled", count: settled.length }]} active={tab} onChange={setTab} className="mb-5" />

      {isLoading ? (
        <div className="skeleton h-32" />
      ) : !shown.length ? (
        <Card>
          <EmptyState icon={<Receipt className="h-6 w-6" />} title={tab === "active" ? "No claims in progress" : "Nothing settled yet"} description="Add the lines, attach receipts and submit. Your manager approves, finance pays." action={can("expense.submit") ? <Button onClick={() => setEditing("new")}>New claim</Button> : undefined} />
        </Card>
      ) : (
        <Card padded={false}>
          <ul className="divide-y">
            {shown.map((claim) => (
              <ExpenseRow
                key={claim.id}
                claim={claim}
                currency={currency}
                locale={locale}
                expanded={expanded === claim.id}
                onToggle={() => setExpanded(expanded === claim.id ? null : claim.id)}
                actions={
                  claim.status === "draft" ? (
                    <Button size="sm" variant="outline" onClick={() => setEditing(claim)}>
                      Edit
                    </Button>
                  ) : claim.status === "submitted" ? (
                    <Button size="sm" variant="ghost" onClick={() => setWithdrawing(claim)}>
                      Withdraw
                    </Button>
                  ) : undefined
                }
              />
            ))}
          </ul>
        </Card>
      )}

      {editing && <ExpenseForm claim={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={() => setEditing(null)} />}
      <ConfirmDialog
        open={Boolean(withdrawing)}
        onClose={() => setWithdrawing(null)}
        onConfirm={() => {
          if (withdrawing) withdraw.mutate(withdrawing.id);
        }}
        loading={withdraw.isPending}
        title="Withdraw this claim?"
        confirmLabel="Withdraw"
        message="It goes back to a draft you can edit and resubmit."
      />
    </>
  );
}
