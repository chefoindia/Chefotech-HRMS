"use client";

import { Field, Select } from "@/components/ui";

/**
 * The seven-day grid behind a week off pattern.
 *
 * The API has accepted these since the shift module was written, and the
 * resolver reads them on every attendance run — but nothing in the product
 * ever rendered them, so a pattern could only be created by calling the
 * endpoint directly. An organization on a six-day week with alternate
 * Saturdays had no way to say so.
 *
 * Two things this has to get right, because both are silent when wrong:
 *
 * The day numbers are fixed — 0 is Sunday through 6 is Saturday — and do not
 * follow the organization's "week starts on" setting. That setting moves where
 * a week is *drawn*; it does not renumber the days. The rows are therefore
 * always rendered in this order, with the name shown rather than the number,
 * so nobody has to hold the mapping in their head.
 *
 * And all seven days must be present in the payload. The schema rejects a
 * partial list rather than assuming the rest are working days, which is right:
 * guessing at silence here means guessing at somebody's weekend.
 */

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const DAY_TYPES = [
  { value: "working", label: "Working" },
  { value: "off", label: "Week off" },
  { value: "half_day", label: "Half day" },
  { value: "alternate", label: "Alternate" },
];

const OCCURRENCES = [1, 2, 3, 4, 5];

export interface WeekOffDay {
  day: number;
  type: "working" | "off" | "half_day" | "alternate";
  offOccurrences?: number[];
  halfDaySession?: "first" | "second";
}

/** Seven working days — the shape a new pattern starts from. */
export function emptyWeek(): WeekOffDay[] {
  return DAY_NAMES.map((_, day) => ({ day, type: day === 0 ? "off" : "working" }));
}

/**
 * Normalise whatever the form is holding into exactly seven ordered days.
 *
 * Editing an existing record hands back whatever the server stored, which may
 * be ordered differently or — for a pattern written before a day type existed
 * — be missing an entry. Rebuilding from the canonical order means the grid
 * always renders seven rows and always submits seven.
 */
export function toWeek(value: unknown): WeekOffDay[] {
  const supplied = Array.isArray(value) ? (value as WeekOffDay[]) : [];
  return DAY_NAMES.map((_, day) => {
    const match = supplied.find((entry) => Number(entry?.day) === day);
    return match ? { ...match, day } : { day, type: "working" as const };
  });
}

export function WeekOffEditor({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (value: WeekOffDay[]) => void;
}) {
  const week = toWeek(value);

  const update = (day: number, patch: Partial<WeekOffDay>) => {
    onChange(
      week.map((entry) => {
        if (entry.day !== day) return entry;
        const next: WeekOffDay = { ...entry, ...patch };

        // Drop the settings that belong to a type this day no longer is —
        // otherwise a day switched from alternate to working still carries
        // occurrences, and the next reader cannot tell they are inert.
        if (next.type !== "alternate") delete next.offOccurrences;
        if (next.type !== "half_day") delete next.halfDaySession;
        if (next.type === "alternate" && !next.offOccurrences?.length) next.offOccurrences = [2, 4];
        if (next.type === "half_day" && !next.halfDaySession) next.halfDaySession = "first";

        return next;
      })
    );
  };

  const toggleOccurrence = (day: number, occurrence: number) => {
    const entry = week.find((d) => d.day === day);
    const current = entry?.offOccurrences ?? [];
    const next = current.includes(occurrence)
      ? current.filter((value) => value !== occurrence)
      : [...current, occurrence].sort((a, b) => a - b);
    update(day, { offOccurrences: next });
  };

  return (
    <div className="sm:col-span-2">
      <Field label="Each day of the week" hint="Sunday through Saturday. Every day needs a rule.">
        <div className="mt-1.5 divide-y rounded-[var(--radius)] border">
          {week.map((entry) => (
            <div key={entry.day} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <span className="w-24 shrink-0 text-[13.5px] font-medium text-[var(--text)]">
                {DAY_NAMES[entry.day]}
              </span>

              <Select
                aria-label={`${DAY_NAMES[entry.day]} type`}
                value={entry.type}
                onChange={(event) => update(entry.day, { type: event.target.value as WeekOffDay["type"] })}
                options={DAY_TYPES}
                className="w-40"
              />

              {entry.type === "alternate" && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[12.5px] text-[var(--text-muted)]">Off on the</span>
                  {OCCURRENCES.map((occurrence) => {
                    const active = entry.offOccurrences?.includes(occurrence);
                    return (
                      <button
                        key={occurrence}
                        type="button"
                        onClick={() => toggleOccurrence(entry.day, occurrence)}
                        aria-pressed={active}
                        className={`h-7 w-7 rounded-md border text-[12.5px] transition-colors ${
                          active
                            ? "border-brand-600 bg-brand-600 text-white"
                            : "border-[var(--border-strong)] text-[var(--text-muted)] hover:bg-[var(--surface-sunken)]"
                        }`}
                      >
                        {occurrence}
                      </button>
                    );
                  })}
                  <span className="text-[12.5px] text-[var(--text-muted)]">
                    {DAY_NAMES[entry.day]} of each month
                  </span>
                </div>
              )}

              {entry.type === "half_day" && (
                <Select
                  aria-label={`${DAY_NAMES[entry.day]} session`}
                  value={entry.halfDaySession ?? "first"}
                  onChange={(event) =>
                    update(entry.day, { halfDaySession: event.target.value as "first" | "second" })
                  }
                  options={[
                    { value: "first", label: "Morning worked" },
                    { value: "second", label: "Afternoon worked" },
                  ]}
                  className="w-48"
                />
              )}
            </div>
          ))}
        </div>
      </Field>
    </div>
  );
}
