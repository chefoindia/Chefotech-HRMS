"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { HandCoins, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatDate, formatMoney, humanise } from "@/lib/format";
import { Button, Card, Drawer, EmptyState, PageHeader } from "@/components/ui";
import { LoanRequestDialog, LoanRow, LoanScheduleTable } from "@/components/modules/LoanBits";
import type { Loan } from "@/lib/moduleTypes";

/** My loans and advances. */
export default function MyLoansPage() {
  const { session, can } = useSession();
  const currency = session?.organization?.currency || "INR";
  const locale = session?.organization?.locale || "en-IN";
  const [requesting, setRequesting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ["loans", "mine"], queryFn: async () => (await api.get<Loan[]>("/loans", { query: { scope: "mine", limit: 50 } })).data, enabled: Boolean(session?.employeeId) });
  const { data: loan } = useQuery({ queryKey: ["loans", openId], queryFn: async () => (await api.get<Loan>(`/loans/${openId}`)).data, enabled: Boolean(openId) });

  return (
    <>
      <PageHeader title="Loans and advances" description="Ask for a loan or a salary advance; repayments are deducted from your salary automatically." actions={can("loan.view_own") && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setRequesting(true)}>Ask for a loan</Button>} />

      {isLoading ? (
        <div className="skeleton h-32" />
      ) : !data?.length ? (
        <Card>
          <EmptyState icon={<HandCoins className="h-6 w-6" />} title="No loans" description="Request a loan or an advance. You see the repayment schedule before you send it, and every deduction on your payslip." action={can("loan.view_own") ? <Button onClick={() => setRequesting(true)}>Ask for a loan</Button> : undefined} />
        </Card>
      ) : (
        <Card padded={false}>
          <ul className="divide-y">
            {data.map((l) => (
              <LoanRow key={l.id} loan={l} currency={currency} locale={locale} onOpen={() => setOpenId(l.id)} />
            ))}
          </ul>
        </Card>
      )}

      {requesting && <LoanRequestDialog onClose={() => setRequesting(false)} currency={currency} locale={locale} />}
      {openId && (
        <Drawer open onClose={() => setOpenId(null)} title={loan ? `#${loan.number} ${loan.type === "advance" ? "Salary advance" : "Loan"}` : "Loan"} width="md">
          {!loan ? (
            <div className="skeleton h-40" />
          ) : (
            <div className="space-y-4 text-[13px]">
              <p>
                {formatMoney(loan.principal, { currency, locale })} · {humanise(loan.status)}
                {loan.decisionComment ? ` · “${loan.decisionComment}”` : ""}
              </p>
              {loan.disbursedOn && <p className="text-[var(--text-muted)]">Paid out {formatDate(loan.disbursedOn, { locale })} by {humanise(loan.disbursedVia || "")}.</p>}
              {loan.status === "active" && (
                <p>
                  Outstanding <strong>{formatMoney(loan.outstanding, { currency, locale })}</strong> · {loan.instalmentsRemaining} instalment{loan.instalmentsRemaining === 1 ? "" : "s"} left
                </p>
              )}
              <LoanScheduleTable loan={loan} currency={currency} locale={locale} />
            </div>
          )}
        </Drawer>
      )}
    </>
  );
}
