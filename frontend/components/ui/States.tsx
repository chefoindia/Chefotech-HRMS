"use client";

import type { ReactNode } from "react";
import { AlertTriangle, Inbox, Lock, RefreshCw, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./Button";

/**
 * Loading, empty and error states.
 *
 * Every list and panel in the product uses these three, so a screen is never
 * a blank rectangle while it thinks, and never a blank rectangle when there is
 * genuinely nothing to show. An empty state that explains what to do next is
 * the difference between a new customer setting the product up and giving up.
 */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} aria-hidden />;
}

export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex items-center gap-4">
          {Array.from({ length: columns }).map((_, columnIndex) => (
            <Skeleton
              key={columnIndex}
              className={cn("h-4", columnIndex === 0 ? "w-40" : "flex-1")}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("card space-y-3 p-5", className)} aria-busy="true">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-8 w-24" />
      <Skeleton className="h-3 w-40" />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-[var(--surface-sunken)] text-[var(--text-subtle)]">
        {icon || <Inbox className="h-6 w-6" aria-hidden />}
      </div>
      <h3 className="text-[15px] font-semibold text-[var(--text)]">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-[13.5px] text-[var(--text-muted)]">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description,
  onRetry,
  className,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-[var(--danger-bg)] text-[var(--danger)]">
        <AlertTriangle className="h-6 w-6" aria-hidden />
      </div>
      <h3 className="text-[15px] font-semibold text-[var(--text)]">{title}</h3>
      {description && (
        <p className="mt-1 max-w-md text-[13.5px] text-[var(--text-muted)]">{description}</p>
      )}
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" icon={<RefreshCw className="h-4 w-4" />} onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** Shown when a permission is missing. Deliberately calm, not alarming. */
export function NoAccessState({
  what = "this page",
  className,
}: {
  what?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-16 text-center", className)}>
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-[var(--surface-sunken)] text-[var(--text-subtle)]">
        <Lock className="h-6 w-6" aria-hidden />
      </div>
      <h3 className="text-[15px] font-semibold text-[var(--text)]">
        You do not have access to {what}
      </h3>
      <p className="mt-1 max-w-sm text-[13.5px] text-[var(--text-muted)]">
        If you think you should, ask an administrator to review your role.
      </p>
    </div>
  );
}

/** Shown when the organization's plan does not include a module. */
export function UpgradeState({
  feature,
  planName,
  className,
}: {
  feature: string;
  planName?: string;
  className?: string;
}) {
  return (
    <div className={cn("card flex flex-col items-center px-6 py-14 text-center", className)}>
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-brand-50 text-brand-600">
        <Sparkles className="h-6 w-6" aria-hidden />
      </div>
      <h3 className="text-[15px] font-semibold text-[var(--text)]">{feature} is not in your plan</h3>
      <p className="mt-1 max-w-sm text-[13.5px] text-[var(--text-muted)]">
        {planName ? `Your ${planName} plan does not include this module.` : "This module is not enabled."}{" "}
        Upgrade to switch it on for your whole organization.
      </p>
    </div>
  );
}

/** A full-page spinner for route-level loading. */
export function PageLoader({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3" role="status">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
      <p className="text-[13px] text-[var(--text-muted)]">{label}…</p>
    </div>
  );
}

/** An inline banner. Used for policy notes, plan warnings, and gentle errors. */
export function Callout({
  tone = "info",
  title,
  children,
  icon,
  className,
}: {
  tone?: "info" | "warning" | "danger" | "success";
  title?: string;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  const tones = {
    info: "bg-[var(--info-bg)] text-[var(--info)] border-sky-200",
    warning: "bg-[var(--warning-bg)] text-[var(--warning)] border-amber-200",
    danger: "bg-[var(--danger-bg)] text-[var(--danger)] border-red-200",
    success: "bg-[var(--success-bg)] text-[var(--success)] border-emerald-200",
  };

  return (
    <div className={cn("flex gap-3 rounded-[var(--radius)] border p-3.5", tones[tone], className)}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0 text-[13.5px]">
        {title && <p className="font-semibold">{title}</p>}
        <div className={cn(title && "mt-0.5", "text-[var(--text)] opacity-90")}>{children}</div>
      </div>
    </div>
  );
}
