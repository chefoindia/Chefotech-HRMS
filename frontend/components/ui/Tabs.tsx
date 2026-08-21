"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export interface TabItem {
  key: string;
  label: string;
  count?: number;
  icon?: ReactNode;
  href?: string;
  disabled?: boolean;
}

/**
 * Tabs.
 *
 * Renders as links when `href` is supplied, so an employee profile tab is a
 * real URL that can be bookmarked and shared — which people do constantly when
 * they send a colleague "look at this person's attendance".
 */
export function Tabs({
  items,
  active,
  onChange,
  className,
}: {
  items: TabItem[];
  active: string;
  onChange?: (key: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("border-b", className)}>
      <nav className="-mb-px flex gap-1 overflow-x-auto" role="tablist">
        {items.map((item) => {
          const isActive = item.key === active;
          const content = (
            <>
              {item.icon}
              {item.label}
              {item.count !== undefined && item.count > 0 && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
                    isActive ? "bg-brand-100 text-brand-700" : "bg-[var(--surface-sunken)] text-[var(--text-muted)]"
                  )}
                >
                  {item.count}
                </span>
              )}
            </>
          );

          const classes = cn(
            "inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-[13.5px] font-medium transition-colors",
            isActive
              ? "border-brand-600 text-brand-700"
              : "border-transparent text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text)]",
            item.disabled && "pointer-events-none opacity-50"
          );

          return item.href ? (
            <Link
              key={item.key}
              href={item.href}
              role="tab"
              aria-selected={isActive}
              className={classes}
            >
              {content}
            </Link>
          ) : (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              disabled={item.disabled}
              onClick={() => onChange?.(item.key)}
              className={classes}
            >
              {content}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

/** A segmented control, for small in-page switches (month/week, list/grid). */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; icon?: ReactNode }>;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 rounded-[calc(var(--radius)-2px)] bg-[var(--surface-sunken)] p-0.5",
        className
      )}
      role="group"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-[calc(var(--radius)-4px)] px-3 py-1.5 text-[13px] font-medium transition-colors",
            value === option.value
              ? "bg-[var(--surface)] text-[var(--text)] shadow-sm"
              : "text-[var(--text-muted)] hover:text-[var(--text)]"
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}
