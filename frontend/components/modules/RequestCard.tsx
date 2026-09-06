"use client";

import { Badge, StatusBadge } from "@/components/ui";
import { formatDate, formatRelative } from "@/lib/format";
import type { EmployeeRequest } from "@/lib/moduleTypes";

const STATUS_TONE: Record<string, string> = { pending: "pending", approved: "approved", completed: "approved", rejected: "rejected", cancelled: "cancelled" };

export function payloadSummary(request: EmployeeRequest, locale: string) {
  const p = request.payload as Record<string, string | number>;
  switch (request.type) {
    case "wfh":
    case "shift_swap":
      return `${formatDate(p.fromDate as string, { locale })} → ${formatDate(p.toDate as string, { locale })}`;
    case "comp_off":
      return `${p.days ?? 1} day(s) for ${formatDate(p.workedOn as string, { locale })}`;
    case "encashment":
      return `${p.days} day(s)`;
    case "advance":
      return `Amount ${p.amount}`;
    default:
      return "";
  }
}

export function effectSummary(request: EmployeeRequest) {
  const e = request.effect as Record<string, unknown> | null;
  if (!e) return null;
  if (e.error) return `Could not be applied: ${String(e.error)}`;
  if (e.markedDates) return `${(e.markedDates as string[]).length} day(s) marked as work from home`;
  if (e.credited) return `${e.credited} day(s) credited`;
  if (e.amount && e.days) return `${e.days} day(s) → ${e.amount} on the next payslip`;
  if (e.documentName) return `Generated: ${String(e.documentName)}`;
  if (e.applied) return `Updated: ${(e.applied as string[]).join(", ")}`;
  if (e.assigned) return "Shift updated";
  if (e.recoveryInputId) return "Recovery scheduled with payroll";
  return null;
}

export function RequestRow({ request, locale, showEmployee, actions }: { request: EmployeeRequest; locale: string; showEmployee?: boolean; actions?: React.ReactNode }) {
  const detail = payloadSummary(request, locale);
  const effect = effectSummary(request);
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-medium text-[var(--text)]">
          {showEmployee && request.employee?.name ? <span className="text-[var(--text-muted)]">{request.employee.name} · </span> : null}
          {request.summary}
        </p>
        <p className="truncate text-[12.5px] text-[var(--text-muted)]">
          {request.typeLabel}
          {detail ? ` · ${detail}` : ""} · asked {formatRelative(request.createdAt)}
          {request.decidedAt ? ` · ${request.status === "rejected" ? "rejected" : "approved"} ${formatRelative(request.decidedAt)}${request.decidedBy ? ` by ${request.decidedBy}` : ""}` : ""}
        </p>
        {request.reason && <p className="mt-0.5 text-[12.5px] text-[var(--text)]">{request.reason}</p>}
        {request.decisionComment && <p className="mt-0.5 text-[12.5px] italic text-[var(--text-muted)]">“{request.decisionComment}”</p>}
        {effect && <p className={`mt-0.5 text-[12px] ${String(effect).startsWith("Could not") ? "text-[var(--danger)]" : "text-[var(--success)]"}`}>{effect}</p>}
      </div>
      {request.viaWorkflow && request.status === "pending" && <Badge tone="info">In approval workflow</Badge>}
      <StatusBadge status={STATUS_TONE[request.status] || request.status} label={request.status === "completed" ? "Approved" : undefined} />
      {actions}
    </li>
  );
}
