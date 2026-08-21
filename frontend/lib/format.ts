/**
 * Formatting helpers.
 *
 * Every one takes the organization's locale/currency/timezone rather than
 * assuming a default, because "₹1,20,000" and "$120,000" are the same number
 * formatted for two different customers.
 */

const DATE_FORMATS: Record<string, Intl.DateTimeFormatOptions> = {
  "DD/MM/YYYY": { day: "2-digit", month: "2-digit", year: "numeric" },
  "MM/DD/YYYY": { month: "2-digit", day: "2-digit", year: "numeric" },
  "YYYY-MM-DD": { year: "numeric", month: "2-digit", day: "2-digit" },
  "DD MMM YYYY": { day: "numeric", month: "short", year: "numeric" },
};

export function formatDate(
  value: string | Date | null | undefined,
  { locale = "en-IN", format = "DD MMM YYYY", timezone }: { locale?: string; format?: string; timezone?: string } = {}
) {
  if (!value) return "—";
  const date = typeof value === "string" ? parseDate(value) : value;
  if (!date || Number.isNaN(date.getTime())) return "—";

  const options = { ...(DATE_FORMATS[format] || DATE_FORMATS["DD MMM YYYY"]) };
  if (timezone) options.timeZone = timezone;

  if (format === "YYYY-MM-DD") {
    // Intl would give 2026-08-20 in most locales but not all; be explicit.
    return new Intl.DateTimeFormat("en-CA", options).format(date);
  }
  return new Intl.DateTimeFormat(locale, options).format(date);
}

export function formatDateTime(
  value: string | Date | null | undefined,
  { locale = "en-IN", timezone, hour12 = true }: { locale?: string; timezone?: string; hour12?: boolean } = {}
) {
  if (!value) return "—";
  const date = typeof value === "string" ? parseDate(value) : value;
  if (!date || Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12,
    timeZone: timezone,
  }).format(date);
}

export function formatTime(
  value: string | Date | null | undefined,
  { locale = "en-IN", timezone, hour12 = true }: { locale?: string; timezone?: string; hour12?: boolean } = {}
) {
  if (!value) return "—";
  const date = typeof value === "string" ? parseDate(value) : value;
  if (!date || Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12,
    timeZone: timezone,
  }).format(date);
}

/** "YYYY-MM-DD" is a calendar label, not an instant — parse it as local noon
 *  so a timezone shift can never move it to the previous day. */
function parseDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day, 12, 0, 0);
  }
  return new Date(value);
}

export function formatMoney(
  amount: number | null | undefined,
  { currency = "INR", locale = "en-IN", compact = false }: { currency?: string; locale?: string; compact?: boolean } = {}
) {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "—";

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: compact ? 1 : 2,
    minimumFractionDigits: compact ? 0 : 2,
    notation: compact ? "compact" : "standard",
  }).format(amount);
}

export function formatNumber(value: number | null | undefined, locale = "en-IN", digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
}

/** Minutes as "7h 45m" — how worked time reads on a payslip. */
export function formatMinutes(minutes: number | null | undefined) {
  if (!minutes || minutes <= 0) return "0m";
  const total = Math.round(minutes);
  const hours = Math.floor(total / 60);
  const remainder = total % 60;
  if (!hours) return `${remainder}m`;
  if (!remainder) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

export function formatDays(days: number | null | undefined) {
  if (days === null || days === undefined) return "—";
  const rounded = Math.round(days * 100) / 100;
  return `${rounded} ${rounded === 1 ? "day" : "days"}`;
}

/** Relative time for feeds and activity trails. */
export function formatRelative(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);

  if (seconds < 45) return "just now";
  if (seconds < 90) return "a minute ago";

  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const thresholds: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["minute", 60],
    ["hour", 3600],
    ["day", 86400],
    ["week", 604800],
    ["month", 2592000],
    ["year", 31536000],
  ];

  let unit: Intl.RelativeTimeFormatUnit = "minute";
  let divisor = 60;
  for (const [candidateUnit, candidateDivisor] of thresholds) {
    if (Math.abs(seconds) < candidateDivisor * (candidateUnit === "year" ? 100 : 1.7)) {
      unit = candidateUnit;
      divisor = candidateDivisor;
      break;
    }
    unit = candidateUnit;
    divisor = candidateDivisor;
  }

  return formatter.format(-Math.round(seconds / divisor), unit);
}

export function initials(name: string | null | undefined) {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

/** snake_case and kebab-case into something a person can read. */
export function humanise(value: string | null | undefined) {
  if (!value) return "";
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^\w/, (c) => c.toUpperCase());
}

export function todayString(timezone?: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  });
  return formatter.format(new Date());
}

export function addDays(dateString: string, days: number) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(year, month - 1, day + days, 12);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function monthLabel(year: number, month: number, locale = "en-IN") {
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(
    new Date(year, month - 1, 1)
  );
}

export function pluralise(count: number, singular: string, plural?: string) {
  return `${count} ${count === 1 ? singular : plural || `${singular}s`}`;
}
