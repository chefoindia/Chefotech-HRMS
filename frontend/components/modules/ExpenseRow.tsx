"use client";

import { Badge, StatusBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, formatMoney, formatRelative, humanise } from "@/lib/format";
import type { ExpenseClaim } from "@/lib/moduleTypes";

const STATUS: Record<string, string> = { draft: "draft", submitted: "pending", approved: "approved", rejected: "rejected", reimbursed: "paid", cancelled: "cancelled" };

export function ExpenseRow({ claim, currency, locale, showEmployee, actions, expanded, onToggle }: { claim: ExpenseClaim; currency: string; locale: string; showEmployee?: boolean; actions?: React.ReactNode; expanded?: boolean; onToggle?: () => void }) {
  return (
    <li className="px-5 py-3.5">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onToggle} className="min-w-0 flex-1 text-left">
          <p className="truncate text-[13.5px] font-medium text-[var(--text)]">
            <span className="mr-1.5 font-mono text-[12px] text-[var(--text-subtle)]">#{claim.number}</span>
            {showEmployee && claim.employee?.name ? <span className="text-[var(--text-muted)]">{claim.employee.name} · </span> : null}
            {claim.title}
          </p>
          <p className="truncate text-[12.5px] text-[var(--text-muted)]">
            {claim.lines.length} line{claim.lines.length === 1 ? "" : "s"} · {claim.submittedAt ? `submitted ${formatRelative(claim.submittedAt)}` : `created ${formatRelative(claim.createdAt)}`}
            {claim.decidedAt ? ` · ${claim.status === "rejected" ? "rejected" : "approved"} ${formatRelative(claim.decidedAt)}${claim.decidedBy ? ` by ${claim.decidedBy}` : ""}` : ""}
            {claim.reimbursement ? ` · ${claim.reimbursement.viaPayroll ? "paid with salary" : `paid by ${humanise(claim.reimbursement.method)}${claim.reimbursement.reference ? ` (${claim.reimbursement.reference})` : ""}`}` : ""}
          </p>
          {claim.decisionComment && <p className="mt-0.5 text-[12.5px] italic text-[var(--text-muted)]">“{claim.decisionComment}”</p>}
        </button>
        <div className="text-right">
          <p className="text-[14px] font-semibold tabular-nums text-[var(--text)]">{formatMoney(claim.approvedTotal ?? claim.total, { currency, locale })}</p>
          {claim.approvedTotal !== null && claim.approvedTotal !== undefined && claim.approvedTotal !== claim.total && <p className="text-[11.5px] text-[var(--text-subtle)]">of {formatMoney(claim.total, { currency, locale })} claimed</p>}
          {claim.advanceAmount > 0 && <p className="text-[11.5px] text-[var(--text-subtle)]">less advance {formatMoney(claim.advanceAmount, { currency, locale })}</p>}
        </div>
        {claim.viaWorkflow && claim.status === "submitted" && <Badge tone="info">In workflow</Badge>}
        <StatusBadge status={STATUS[claim.status] || claim.status} label={claim.status === "submitted" ? "Awaiting approval" : humanise(claim.status)} />
        {actions}
      </div>
      {expanded && (
        <table className="mt-3 w-full text-[12.5px]">
          <thead className="text-left text-[11px] uppercase tracking-wide text-[var(--text-subtle)]">
            <tr>
              <th className="py-1">Date</th>
              <th className="py-1">Category</th>
              <th className="py-1">Description</th>
              <th className="py-1 text-right">Amount</th>
              <th className="py-1 text-right">Receipt</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {claim.lines.map((l, i) => (
              <tr key={l.id || i}>
                <td className="py-1.5">{formatDate(l.date, { locale })}</td>
                <td className="py-1.5">{humanise(l.category)}</td>
                <td className="py-1.5 text-[var(--text-muted)]">{l.description || "—"}{l.distanceKm ? ` (${l.distanceKm} km)` : ""}</td>
                <td className="py-1.5 text-right tabular-nums">{formatMoney(l.amount, { currency, locale })}</td>
                <td className="py-1.5 text-right">
                  {l.receiptFileId ? (
                    <a href={api.fileUrl(`/files/${l.receiptFileId}/content`)} target="_blank" rel="noopener" className="text-brand-700 hover:underline">
                      View
                    </a>
                  ) : (
                    <span className="text-[var(--text-subtle)]">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </li>
  );
}
