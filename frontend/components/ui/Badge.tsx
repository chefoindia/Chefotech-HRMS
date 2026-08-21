"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { humanise } from "@/lib/format";

type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info" | "purple";

const TONES: Record<Tone, string> = {
  neutral: "bg-[var(--surface-sunken)] text-[var(--text-muted)] ring-[var(--border)]",
  brand: "bg-brand-50 text-brand-700 ring-brand-200",
  success: "bg-[var(--success-bg)] text-[var(--success)] ring-emerald-200",
  warning: "bg-[var(--warning-bg)] text-[var(--warning)] ring-amber-200",
  danger: "bg-[var(--danger-bg)] text-[var(--danger)] ring-red-200",
  info: "bg-[var(--info-bg)] text-[var(--info)] ring-sky-200",
  purple: "bg-violet-50 text-violet-700 ring-violet-200",
};

export function Badge({
  children,
  tone = "neutral",
  dot,
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium ring-1 ring-inset",
        TONES[tone],
        className
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

/**
 * Status badges with a shared colour language across the product.
 *
 * The same status means the same colour whether it appears on an employee, an
 * attendance row, a leave request or a payroll run — so people learn the
 * palette once instead of per screen.
 */
const STATUS_TONES: Record<string, Tone> = {
  // Employees
  active: "success",
  on_leave: "info",
  notice_period: "warning",
  suspended: "danger",
  resigned: "neutral",
  terminated: "danger",
  inactive: "neutral",
  draft: "neutral",
  invited: "brand",

  // Attendance
  present: "success",
  absent: "danger",
  half_day: "warning",
  weekly_off: "neutral",
  holiday: "purple",
  leave: "info",
  work_from_home: "info",
  on_duty: "info",
  comp_off: "purple",
  pending: "warning",
  not_applicable: "neutral",

  // Requests and runs
  approved: "success",
  rejected: "danger",
  cancelled: "neutral",
  withdrawn: "neutral",
  processed: "info",
  processing: "warning",
  locked: "purple",
  paid: "success",
  failed: "danger",

  // Devices and jobs
  online: "success",
  offline: "neutral",
  error: "danger",
  unknown: "neutral",
  queued: "warning",
  running: "info",
  succeeded: "success",
  success: "success",
  partial: "warning",

  // Documents
  verified: "success",
  pending_review: "warning",
  expired: "danger",
};

export function StatusBadge({
  status,
  label,
  className,
}: {
  status: string;
  label?: string;
  className?: string;
}) {
  return (
    <Badge tone={STATUS_TONES[status] || "neutral"} dot className={className}>
      {label || humanise(status)}
    </Badge>
  );
}

/** A small count pill, for tabs and sidebar items. */
export function CountPill({ count, tone = "neutral" }: { count: number; tone?: Tone }) {
  if (!count) return null;
  return (
    <span
      className={cn(
        "ml-auto inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
        tone === "danger" ? "bg-[var(--danger)] text-white" : "bg-brand-100 text-brand-700"
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
