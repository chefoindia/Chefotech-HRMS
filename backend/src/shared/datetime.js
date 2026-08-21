"use strict";

const dayjs = require("dayjs");
const utc = require("dayjs/plugin/utc");
const timezone = require("dayjs/plugin/timezone");
const customParseFormat = require("dayjs/plugin/customParseFormat");
const isoWeek = require("dayjs/plugin/isoWeek");
const duration = require("dayjs/plugin/duration");

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);
dayjs.extend(isoWeek);
dayjs.extend(duration);

/**
 * Time handling for a multi-tenant HRMS.
 *
 * Two representations, never mixed:
 *   - INSTANT: a real moment, stored as a UTC Date. Punches, timestamps.
 *   - CALENDAR DATE: "2026-08-20", a label with no timezone. Attendance days,
 *     leave dates, payroll periods, holidays.
 *
 * A punch at 00:30 IST belongs to the 20th in Kolkata and to the 19th in
 * London. Which day an attendance record lands on is therefore always decided
 * in the ORGANIZATION's timezone, never the server's — the server's timezone
 * is never read anywhere in this codebase.
 */

const DATE_FORMAT = "YYYY-MM-DD";
const DEFAULT_TZ = "Asia/Kolkata";

function tzOf(orgTimezone) {
  return orgTimezone || DEFAULT_TZ;
}

/** Current instant as a dayjs in the organization's zone. */
function nowIn(orgTimezone) {
  return dayjs().tz(tzOf(orgTimezone));
}

/** Today's calendar date in the organization's zone: "2026-08-20". */
function todayString(orgTimezone) {
  return nowIn(orgTimezone).format(DATE_FORMAT);
}

/** Which calendar date does this instant fall on, for this organization? */
function toDateString(instant, orgTimezone) {
  if (!instant) return null;
  return dayjs(instant).tz(tzOf(orgTimezone)).format(DATE_FORMAT);
}

/** Start-of-day instant (UTC Date) for a calendar date in the org's zone. */
function startOfDay(dateString, orgTimezone) {
  return dayjs.tz(`${dateString} 00:00:00`, "YYYY-MM-DD HH:mm:ss", tzOf(orgTimezone)).toDate();
}

/** Exclusive end-of-day instant, i.e. the next midnight. */
function endOfDay(dateString, orgTimezone) {
  return dayjs
    .tz(`${dateString} 00:00:00`, "YYYY-MM-DD HH:mm:ss", tzOf(orgTimezone))
    .add(1, "day")
    .toDate();
}

/** Half-open [start, end) instant range covering a calendar date. */
function dayRange(dateString, orgTimezone) {
  return { start: startOfDay(dateString, orgTimezone), end: endOfDay(dateString, orgTimezone) };
}

/** Half-open instant range covering a span of calendar dates, inclusive. */
function rangeBetween(fromDateString, toDateString_, orgTimezone) {
  return {
    start: startOfDay(fromDateString, orgTimezone),
    end: endOfDay(toDateString_, orgTimezone),
  };
}

/** Combine a calendar date and "HH:mm" into a real instant in the org's zone. */
function combine(dateString, timeString, orgTimezone) {
  return dayjs
    .tz(`${dateString} ${timeString}`, "YYYY-MM-DD HH:mm", tzOf(orgTimezone))
    .toDate();
}

/**
 * Resolve a shift's start and end instants for a given calendar date,
 * accounting for shifts that cross midnight.
 *
 * A 22:00–06:00 shift on 2026-08-20 runs from 20th 22:00 to 21st 06:00.
 * `crossesMidnight` is derived from the times, not configured, so a tenant
 * cannot get it wrong.
 */
function resolveShiftWindow(dateString, startTime, endTime, orgTimezone) {
  const start = combine(dateString, startTime, orgTimezone);
  let end = combine(dateString, endTime, orgTimezone);
  const crossesMidnight = end <= start;
  if (crossesMidnight) {
    end = dayjs(end).tz(tzOf(orgTimezone)).add(1, "day").toDate();
  }
  return { start, end, crossesMidnight };
}

function minutesBetween(a, b) {
  if (!a || !b) return 0;
  return Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));
}

/** Minutes of a "HH:mm" since midnight. */
function timeToMinutes(timeString) {
  if (!timeString) return 0;
  const [h, m] = String(timeString).split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(minutes) {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** "7h 45m" for UI and payslips. */
function formatMinutes(minutes) {
  const total = Math.max(0, Math.round(minutes || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return `${m}m`;
  if (!m) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Every calendar date from → to inclusive. Guarded against runaway ranges. */
function eachDate(fromDateString, toDateString_, maxDays = 800) {
  const out = [];
  let cursor = dayjs(fromDateString, DATE_FORMAT);
  const end = dayjs(toDateString_, DATE_FORMAT);
  if (!cursor.isValid() || !end.isValid()) return out;
  let guard = 0;
  while ((cursor.isBefore(end) || cursor.isSame(end, "day")) && guard++ < maxDays) {
    out.push(cursor.format(DATE_FORMAT));
    cursor = cursor.add(1, "day");
  }
  return out;
}

function addDays(dateString, days) {
  return dayjs(dateString, DATE_FORMAT).add(days, "day").format(DATE_FORMAT);
}

function daysBetween(fromDateString, toDateString_) {
  return dayjs(toDateString_, DATE_FORMAT).diff(dayjs(fromDateString, DATE_FORMAT), "day") + 1;
}

/** 0 = Sunday … 6 = Saturday, matching the weekly-off configuration. */
function weekdayIndex(dateString) {
  return dayjs(dateString, DATE_FORMAT).day();
}

/** Which occurrence of that weekday in the month (1st Saturday, 3rd, ...). */
function weekdayOccurrence(dateString) {
  return Math.floor((dayjs(dateString, DATE_FORMAT).date() - 1) / 7) + 1;
}

function monthBounds(year, month) {
  const start = dayjs(`${year}-${String(month).padStart(2, "0")}-01`, DATE_FORMAT);
  return {
    start: start.format(DATE_FORMAT),
    end: start.endOf("month").format(DATE_FORMAT),
    days: start.daysInMonth(),
  };
}

function isValidDateString(value) {
  return typeof value === "string" && dayjs(value, DATE_FORMAT, true).isValid();
}

/** Financial year label for a date, given the FY start month (4 = April). */
function financialYearOf(dateString, startMonth = 4) {
  const d = dayjs(dateString, DATE_FORMAT);
  const year = d.month() + 1 >= startMonth ? d.year() : d.year() - 1;
  return { start: year, end: year + 1, label: `${year}-${String((year + 1) % 100).padStart(2, "0")}` };
}

/** Whole years elapsed — used for probation, tenure and accrual eligibility. */
function yearsSince(dateString, asOfDateString) {
  const from = dayjs(dateString, DATE_FORMAT);
  const to = asOfDateString ? dayjs(asOfDateString, DATE_FORMAT) : dayjs();
  return to.diff(from, "year", true);
}

function monthsSince(dateString, asOfDateString) {
  const from = dayjs(dateString, DATE_FORMAT);
  const to = asOfDateString ? dayjs(asOfDateString, DATE_FORMAT) : dayjs();
  return to.diff(from, "month", true);
}

const SUPPORTED_TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Kuala_Lumpur",
  "Asia/Manila",
  "Asia/Jakarta",
  "Asia/Dhaka",
  "Asia/Karachi",
  "Asia/Colombo",
  "Asia/Kathmandu",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Australia/Sydney",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "UTC",
];

function isValidTimezone(tz) {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  dayjs,
  DATE_FORMAT,
  DEFAULT_TZ,
  SUPPORTED_TIMEZONES,
  nowIn,
  todayString,
  toDateString,
  startOfDay,
  endOfDay,
  dayRange,
  rangeBetween,
  combine,
  resolveShiftWindow,
  minutesBetween,
  timeToMinutes,
  minutesToTime,
  formatMinutes,
  eachDate,
  addDays,
  daysBetween,
  weekdayIndex,
  weekdayOccurrence,
  monthBounds,
  isValidDateString,
  isValidTimezone,
  financialYearOf,
  yearsSince,
  monthsSince,
};
