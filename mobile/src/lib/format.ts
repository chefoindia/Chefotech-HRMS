import { format, formatDistanceToNow, parseISO } from "date-fns";

/**
 * Formatting helpers shared by every screen, so a rupee amount or a date
 * reads the same on the payslip, the expense claim and the loan schedule.
 */

export function money(amount: number | null | undefined, currency = "INR", digits = 0) {
  const value = Number(amount) || 0;
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
  } catch {
    return `${currency} ${value.toFixed(digits)}`;
  }
}

function toDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  // A bare calendar date ("2026-03-04") must not shift by a time zone.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return parseISO(value);
  return new Date(value);
}

export function dateLabel(value: string | Date | null | undefined, pattern = "d MMM yyyy") {
  if (!value) return "—";
  try {
    return format(toDate(value), pattern);
  } catch {
    return String(value);
  }
}

export function dateTimeLabel(value: string | Date | null | undefined) {
  return dateLabel(value, "d MMM yyyy, HH:mm");
}

export function timeLabel(value: string | Date | null | undefined) {
  return value ? dateLabel(value, "HH:mm") : "—";
}

export function relative(value: string | Date | null | undefined) {
  if (!value) return "";
  try {
    return formatDistanceToNow(toDate(value), { addSuffix: true });
  } catch {
    return "";
  }
}

/** "2026-03" → "Mar 2026". */
export function periodLabel(periodKey: string | null | undefined) {
  if (!periodKey) return "next run";
  const [y, m] = periodKey.split("-").map(Number);
  if (!y || !m) return periodKey;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en", { month: "short", year: "numeric", timeZone: "UTC" });
}

export function minutesLabel(minutes: number | null | undefined) {
  if (!minutes) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

export function humanise(value: string | null | undefined) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());
}

export function todayString() {
  return format(new Date(), "yyyy-MM-dd");
}

/** A label for a populated reference ({ name }) or a raw id. */
export function refName(value: unknown, fallback = "—"): string {
  if (!value) return fallback;
  if (typeof value === "string") return fallback;
  const v = value as { name?: string; personal?: { firstName?: string; lastName?: string }; employeeCode?: string };
  if (v.name) return v.name;
  if (v.personal) return [v.personal.firstName, v.personal.lastName].filter(Boolean).join(" ") || v.employeeCode || fallback;
  return fallback;
}

/** The next N months as period keys, for "recover from" and "first deduction" pickers. */
export function upcomingPeriods(count = 6): { value: string; label: string }[] {
  const now = new Date();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i + 1, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return { value: key, label: periodLabel(key) };
  });
}
