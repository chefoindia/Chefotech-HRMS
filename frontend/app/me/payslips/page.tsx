"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatDate, formatMoney } from "@/lib/format";
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  Modal,
  NoAccessState,
  PageHeader,
  useToast,
} from "@/components/ui";

interface Payslip {
  id: string;
  payslipNumber: string;
  periodLabel: string;
  gross: number;
  totalDeductions: number;
  net: number;
  publishedAt: string;
  periodId: { name: string; payDate: string } | string;
  snapshot?: {
    lines: Array<{ code: string; name: string; type: string; amount: number; showOnPayslip: boolean }>;
    attendance: { totalDays: number; payableDays: number; lossOfPayDays: number; paidLeaveDays: number };
    breakdown: Array<{ rule: string; detail: string; effect: string }>;
  };
}

export default function MyPayslipsPage() {
  const { session, can } = useSession();
  const toast = useToast();
  const locale = session?.organization?.locale || "en-IN";
  const currency = session?.organization?.currency || "INR";

  const [viewing, setViewing] = useState<Payslip | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["me", "payslips"],
    queryFn: async () => {
      const { data: payslips } = await api.get<Payslip[]>("/payroll/me/payslips");
      return payslips;
    },
    enabled: can("payroll.view_own_payslip"),
  });

  const open = async (payslip: Payslip) => {
    try {
      const { data: full } = await api.get<Payslip>(`/payroll/payslips/${payslip.id}`);
      setViewing(full);
    } catch (error) {
      toast.fromError(error, "Could not open that payslip.");
    }
  };

  if (!can("payroll.view_own_payslip")) return <NoAccessState what="payslips" />;

  return (
    <>
      <PageHeader
        title="My payslips"
        description="Every payslip published to you, with the working behind each figure."
      />

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((index) => (
            <div key={index} className="skeleton h-16" />
          ))}
        </div>
      ) : !data?.length ? (
        <Card>
          <EmptyState
            icon={<Wallet className="h-6 w-6" />}
            title="No payslips yet"
            description="They appear here as soon as payroll publishes them."
          />
        </Card>
      ) : (
        <Card padded={false}>
          <ul className="divide-y">
            {data.map((payslip) => (
              <li key={payslip.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium text-[var(--text)]">{payslip.periodLabel}</p>
                  <p className="font-mono text-[12px] text-[var(--text-muted)]">
                    {payslip.payslipNumber}
                  </p>
                </div>

                <div className="hidden text-right sm:block">
                  <p className="text-[11.5px] uppercase text-[var(--text-subtle)]">Gross</p>
                  <p className="tabular text-[13.5px]">
                    {formatMoney(payslip.gross, { locale, currency })}
                  </p>
                </div>

                <div className="hidden text-right md:block">
                  <p className="text-[11.5px] uppercase text-[var(--text-subtle)]">Deductions</p>
                  <p className="tabular text-[13.5px]">
                    {formatMoney(payslip.totalDeductions, { locale, currency })}
                  </p>
                </div>

                <div className="text-right">
                  <p className="text-[11.5px] uppercase text-[var(--text-subtle)]">Net</p>
                  <p className="tabular text-[15px] font-semibold text-[var(--text)]">
                    {formatMoney(payslip.net, { locale, currency })}
                  </p>
                </div>

                <Button variant="outline" size="sm" onClick={() => open(payslip)}>
                  View
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {viewing && (
        <Modal
          open
          onClose={() => setViewing(null)}
          title={`Payslip · ${viewing.periodLabel}`}
          description={viewing.payslipNumber}
          size="md"
          footer={<Button variant="outline" onClick={() => setViewing(null)}>Close</Button>}
        >
          <div className="space-y-5">
            {viewing.snapshot?.attendance && (
              <div className="grid grid-cols-4 gap-3">
                <Metric label="Days" value={viewing.snapshot.attendance.totalDays} />
                <Metric label="Payable" value={viewing.snapshot.attendance.payableDays} />
                <Metric label="Loss of pay" value={viewing.snapshot.attendance.lossOfPayDays} />
                <Metric label="Paid leave" value={viewing.snapshot.attendance.paidLeaveDays} />
              </div>
            )}

            {viewing.snapshot?.lines && (
              <>
                <Section
                  title="Earnings"
                  lines={viewing.snapshot.lines.filter(
                    (line) => line.type === "earning" && line.showOnPayslip
                  )}
                  locale={locale}
                  currency={currency}
                />
                <Section
                  title="Deductions"
                  lines={viewing.snapshot.lines.filter(
                    (line) => line.type === "deduction" && line.showOnPayslip
                  )}
                  locale={locale}
                  currency={currency}
                />
              </>
            )}

            <div className="flex items-center justify-between rounded-[var(--radius)] border border-brand-200 bg-brand-50 p-3.5">
              <span className="text-[14px] font-semibold text-brand-700">Net payable</span>
              <span className="tabular text-[18px] font-semibold text-brand-700">
                {formatMoney(viewing.net, { locale, currency })}
              </span>
            </div>

            {viewing.snapshot?.breakdown && (
              <details>
                <summary className="cursor-pointer text-[13px] font-medium text-[var(--text-muted)]">
                  How this was calculated
                </summary>
                <ul className="mt-2 space-y-1">
                  {viewing.snapshot.breakdown.map((entry, index) => (
                    <li key={index} className="flex gap-3 text-[12.5px]">
                      <span className="min-w-0 flex-1 text-[var(--text-muted)]">{entry.detail}</span>
                      <span className="shrink-0 font-medium text-[var(--text)]">{entry.effect}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[var(--radius)] border p-2.5 text-center">
      <p className="text-[11px] uppercase text-[var(--text-subtle)]">{label}</p>
      <p className="tabular mt-0.5 text-[15px] font-semibold text-[var(--text)]">{value}</p>
    </div>
  );
}

function Section({
  title,
  lines,
  locale,
  currency,
}: {
  title: string;
  lines: Array<{ code: string; name: string; amount: number }>;
  locale: string;
  currency: string;
}) {
  if (!lines.length) return null;

  return (
    <div>
      <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
        {title}
      </p>
      <ul className="divide-y rounded-[var(--radius)] border">
        {lines.map((line) => (
          <li key={line.code} className="flex items-center justify-between px-3 py-2 text-[13px]">
            <span className="text-[var(--text)]">{line.name}</span>
            <span className="tabular font-medium">
              {formatMoney(line.amount, { locale, currency })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
