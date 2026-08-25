import { CheckCircle2 } from "lucide-react";

/**
 * A small "how much of this is filled in" indicator for a configuration
 * screen — how efficiently the data has actually been entered, not just
 * whether the record exists.
 *
 * Deliberately not a blocking gate: every field it counts stays fully
 * editable and saveable at 0%. It is information for the person filling the
 * form, not a wall in front of them — same philosophy as the onboarding
 * checklist it sits next to.
 */
export function CompletionBar({
  percent,
  filled,
  total,
  label = "Filled in",
}: {
  percent: number;
  filled: number;
  total: number;
  label?: string;
}) {
  if (total === 0) return null;
  const complete = percent >= 100;

  return (
    <div className="flex items-center gap-3">
      <div className="h-1.5 w-28 overflow-hidden rounded-full bg-[var(--border)]">
        <div
          className={complete ? "h-full rounded-full bg-[var(--success)]" : "h-full rounded-full bg-brand-600"}
          style={{ width: `${percent}%`, transition: "width 300ms ease" }}
        />
      </div>
      <span className="flex items-center gap-1 text-[12px] font-medium text-[var(--text-muted)]">
        {complete && <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" aria-hidden />}
        {label} {percent}%
        <span className="text-[var(--text-subtle)]">
          ({filled}/{total})
        </span>
      </span>
    </div>
  );
}
