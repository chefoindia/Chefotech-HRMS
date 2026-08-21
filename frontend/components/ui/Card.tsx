"use client";

import type { ReactNode } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

export function Card({
  children,
  className,
  padded = true,
  ...props
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  [key: string]: unknown;
}) {
  return (
    <div className={cn("card", padded && "p-5", className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold text-[var(--text)]">{title}</h3>
        {description && (
          <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
  trend?: { value: number; label?: string };
  tone?: "default" | "success" | "warning" | "danger" | "info";
  loading?: boolean;
  onClick?: () => void;
  className?: string;
}

const TONES = {
  default: { bg: "bg-brand-50", fg: "text-brand-600" },
  success: { bg: "bg-[var(--success-bg)]", fg: "text-[var(--success)]" },
  warning: { bg: "bg-[var(--warning-bg)]", fg: "text-[var(--warning)]" },
  danger: { bg: "bg-[var(--danger-bg)]", fg: "text-[var(--danger)]" },
  info: { bg: "bg-[var(--info-bg)]", fg: "text-[var(--info)]" },
};

export function StatCard({
  label,
  value,
  hint,
  icon,
  trend,
  tone = "default",
  loading,
  onClick,
  className,
}: StatCardProps) {
  const tones = TONES[tone];
  const Wrapper = onClick ? "button" : "div";

  return (
    <Wrapper
      onClick={onClick}
      className={cn(
        "card w-full p-4 text-left transition-shadow",
        onClick && "cursor-pointer hover:shadow-md",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
            {label}
          </p>

          {loading ? (
            <div className="skeleton mt-2 h-7 w-20" />
          ) : (
            <p className="tabular mt-1.5 text-2xl font-semibold text-[var(--text)]">{value}</p>
          )}

          {(hint || trend) && !loading && (
            <div className="mt-1 flex items-center gap-2 text-[12.5px]">
              {trend && (
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 font-medium",
                    trend.value >= 0 ? "text-[var(--success)]" : "text-[var(--danger)]"
                  )}
                >
                  {trend.value >= 0 ? (
                    <TrendingUp className="h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <TrendingDown className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {Math.abs(trend.value)}%
                </span>
              )}
              {hint && <span className="text-[var(--text-muted)]">{hint}</span>}
            </div>
          )}
        </div>

        {icon && (
          <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-lg", tones.bg, tones.fg)}>
            {icon}
          </span>
        )}
      </div>
    </Wrapper>
  );
}

/** Page header: title, description, breadcrumb slot and actions. */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-6", className)}>
      {breadcrumb}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-[var(--text)] sm:text-[22px]">
            {title}
          </h1>
          {description && (
            <p className="mt-1 max-w-2xl text-[13.5px] text-[var(--text-muted)]">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/** A labelled value, used all over employee profiles and detail panels. */
export function DetailItem({
  label,
  value,
  className,
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[12px] font-medium uppercase tracking-wide text-[var(--text-subtle)]">
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-sm text-[var(--text)]">{value ?? "—"}</dd>
    </div>
  );
}

export function DetailGrid({
  children,
  columns = 3,
  className,
}: {
  children: ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "grid gap-x-6 gap-y-4",
        columns === 2 && "grid-cols-1 sm:grid-cols-2",
        columns === 3 && "grid-cols-2 lg:grid-cols-3",
        columns === 4 && "grid-cols-2 lg:grid-cols-4",
        className
      )}
    >
      {children}
    </dl>
  );
}
