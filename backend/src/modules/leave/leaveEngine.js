"use strict";

const dt = require("../../shared/datetime");

/**
 * The leave calculation engine.
 *
 * Pure, like the attendance engine: no database, no clock. Given the calendar
 * context for a date range and a rule, it decides how many days actually come
 * out of a balance and why.
 *
 * The interesting part is the sandwich rule. Applying for Friday and Monday
 * either costs 2 days or 4, depending on the policy, and getting it wrong is
 * both a payroll error and an argument with an employee. All three
 * interpretations are supported and the chosen one is recorded on the request.
 */

const PORTION_VALUE = { full: 1, first_half: 0.5, second_half: 0.5 };

/**
 * @param {Object} input
 * @param {string} input.fromDate
 * @param {string} input.toDate
 * @param {string} input.fromPortion  full | first_half | second_half
 * @param {string} input.toPortion
 * @param {Object} input.rule         the LeavePolicy rule for this leave type
 * @param {Object} input.calendar     { [date]: { isHoliday, holidayName, isWeeklyOff, isHalfDayOff } }
 * @returns {{ days: Array, leaveDays: number, calendarDays: number, breakdown: Array }}
 */
function computeDays({ fromDate, toDate, fromPortion = "full", toPortion = "full", rule, calendar }) {
  const dates = dt.eachDate(fromDate, toDate, 400);
  const breakdown = [];
  const counting = (rule && rule.counting) || { holidays: "exclude", weeklyOffs: "exclude" };

  // First pass: classify every date.
  const classified = dates.map((date, index) => {
    const info = calendar[date] || {};
    const isFirst = index === 0;
    const isLast = index === dates.length - 1;

    let portion = "full";
    if (isFirst && fromPortion !== "full") portion = fromPortion;
    if (isLast && toPortion !== "full" && dates.length > 1) portion = toPortion;
    if (dates.length === 1 && fromPortion !== "full") portion = fromPortion;

    return {
      date,
      portion,
      isHoliday: Boolean(info.isHoliday),
      holidayName: info.holidayName || null,
      isWeeklyOff: Boolean(info.isWeeklyOff),
      isNonWorking: Boolean(info.isHoliday || info.isWeeklyOff),
      index,
    };
  });

  // Second pass: decide whether each non-working day is deducted.
  const days = classified.map((day) => {
    const base = PORTION_VALUE[day.portion] || 1;

    if (!day.isNonWorking) {
      return { ...day, deductedDays: base, reason: null };
    }

    const mode = day.isHoliday ? counting.holidays : counting.weeklyOffs;
    const label = day.isHoliday ? day.holidayName || "Holiday" : "Weekly off";

    if (mode === "include") {
      return { ...day, deductedDays: base, reason: `${label} counted (policy includes days off)` };
    }

    if (mode === "sandwich") {
      // Deducted only if there is a working leave day on BOTH sides — that is
      // what makes it a sandwich rather than leave that merely touches a
      // weekend at one end.
      const before = classified.slice(0, day.index).some((d) => !d.isNonWorking);
      const after = classified.slice(day.index + 1).some((d) => !d.isNonWorking);
      const sandwiched = before && after;
      return {
        ...day,
        deductedDays: sandwiched ? base : 0,
        reason: sandwiched
          ? `${label} counted (surrounded by leave on both sides)`
          : `${label} not counted (not surrounded by leave)`,
      };
    }

    return { ...day, deductedDays: 0, reason: `${label} not counted` };
  });

  const leaveDays = round2(days.reduce((sum, d) => sum + d.deductedDays, 0));
  const nonWorkingExcluded = days.filter((d) => d.isNonWorking && d.deductedDays === 0).length;
  const nonWorkingCounted = days.filter((d) => d.isNonWorking && d.deductedDays > 0).length;

  breakdown.push({
    rule: "calendar_span",
    detail: `${dates.length} calendar day${dates.length === 1 ? "" : "s"} from ${fromDate} to ${toDate}`,
    effect: `${dates.length} days`,
  });
  if (fromPortion !== "full" || toPortion !== "full") {
    breakdown.push({
      rule: "half_day",
      detail: `${fromPortion !== "full" ? `Start: ${fromPortion.replace("_", " ")}. ` : ""}${toPortion !== "full" && dates.length > 1 ? `End: ${toPortion.replace("_", " ")}.` : ""}`.trim(),
      effect: "-0.5 per half day",
    });
  }
  if (nonWorkingExcluded) {
    breakdown.push({
      rule: "days_off_excluded",
      detail: `${nonWorkingExcluded} holiday/weekly-off day${nonWorkingExcluded === 1 ? "" : "s"} inside the range`,
      effect: `-${nonWorkingExcluded} days`,
    });
  }
  if (nonWorkingCounted) {
    breakdown.push({
      rule: counting.holidays === "sandwich" || counting.weeklyOffs === "sandwich" ? "sandwich_rule" : "days_off_included",
      detail: `${nonWorkingCounted} day${nonWorkingCounted === 1 ? "" : "s"} off counted by the policy`,
      effect: `+${nonWorkingCounted} days`,
    });
  }
  breakdown.push({ rule: "total", detail: "Days deducted from balance", effect: `${leaveDays}` });

  return { days, leaveDays, calendarDays: dates.length, breakdown };
}

/**
 * Is this employee eligible for this leave type today?
 * @returns {{ eligible: boolean, reasons: string[] }}
 */
function checkEligibility({ employee, leaveType, asOfDate, isProbation, isNoticePeriod }) {
  const reasons = [];
  const eligibility = leaveType.eligibility || {};

  if (eligibility.genders && eligibility.genders.length) {
    const gender = employee.personal && employee.personal.gender;
    if (!eligibility.genders.includes(gender)) {
      reasons.push(`${leaveType.name} is not available for your profile.`);
    }
  }

  if (eligibility.employmentTypes && eligibility.employmentTypes.length) {
    const type = employee.employment && employee.employment.employmentType;
    if (!eligibility.employmentTypes.includes(type)) {
      reasons.push(`${leaveType.name} is not available for ${String(type || "").replace(/_/g, " ")} employees.`);
    }
  }

  if (eligibility.departmentIds && eligibility.departmentIds.length) {
    const departmentId = String((employee.employment && employee.employment.departmentId) || "");
    if (!eligibility.departmentIds.map(String).includes(departmentId)) {
      reasons.push(`${leaveType.name} is not available for your department.`);
    }
  }

  if (eligibility.locationIds && eligibility.locationIds.length) {
    const locationId = String((employee.employment && employee.employment.locationId) || "");
    if (!eligibility.locationIds.map(String).includes(locationId)) {
      reasons.push(`${leaveType.name} is not available at your work location.`);
    }
  }

  if (eligibility.minimumServiceMonths > 0) {
    const joining = employee.employment && employee.employment.joiningDate;
    if (!joining) {
      reasons.push("A joining date is needed before this leave can be taken.");
    } else {
      const months = dt.monthsSince(dt.toDateString(joining, "UTC"), asOfDate);
      if (months < eligibility.minimumServiceMonths) {
        const remaining = Math.ceil(eligibility.minimumServiceMonths - months);
        reasons.push(
          `${leaveType.name} becomes available after ${eligibility.minimumServiceMonths} months of service (${remaining} more to go).`
        );
      }
    }
  }

  if (isProbation && eligibility.availableDuringProbation === false) {
    reasons.push(`${leaveType.name} cannot be taken during probation.`);
  }
  if (isNoticePeriod && eligibility.availableDuringNotice === false) {
    reasons.push(`${leaveType.name} cannot be taken during the notice period.`);
  }

  return { eligible: reasons.length === 0, reasons };
}

/**
 * Allocation for a leave year, prorated for a mid-year joiner or leaver.
 */
function computeAllocation({ rule, periodStart, periodEnd, joiningDate, exitDate }) {
  const allocation = rule.allocation || {};
  const breakdown = [];

  if (allocation.mode === "none" || allocation.mode === "unlimited") {
    return { days: 0, breakdown: [{ rule: "allocation", detail: `Mode: ${allocation.mode}`, effect: "0" }] };
  }

  let periodDays = allocation.daysPerPeriod || 0;

  if (allocation.mode === "monthly") {
    periodDays = (allocation.daysPerPeriod || 0) * 12;
    breakdown.push({
      rule: "allocation_mode",
      detail: `${allocation.daysPerPeriod} days per month`,
      effect: `${periodDays} days per year`,
    });
  } else if (allocation.mode === "quarterly") {
    periodDays = (allocation.daysPerPeriod || 0) * 4;
    breakdown.push({
      rule: "allocation_mode",
      detail: `${allocation.daysPerPeriod} days per quarter`,
      effect: `${periodDays} days per year`,
    });
  } else if (allocation.mode === "accrual") {
    periodDays = (allocation.accrualPerMonth || 0) * 12;
    breakdown.push({
      rule: "allocation_mode",
      detail: `Accrues ${allocation.accrualPerMonth} days per completed month`,
      effect: `up to ${periodDays} days per year`,
    });
  } else {
    breakdown.push({ rule: "allocation_mode", detail: "Annual allocation", effect: `${periodDays} days` });
  }

  let days = periodDays;

  // Proration for someone who joined after the leave year started.
  //
  // The caller may hand us a Date (straight from Mongo) or a "YYYY-MM-DD"
  // string. String(aDate) yields "Thu Aug 20 2026 …", which is not a date this
  // function can compare or subtract — left unnormalised it silently produced
  // NaN allocations, and a NaN balance fails validation on save rather than
  // showing up as a wrong number.
  const joining = asDateString(joiningDate);
  if (allocation.prorateOnJoining && joining && joining > periodStart) {
    const total = dt.daysBetween(periodStart, periodEnd);
    const eligible = dt.daysBetween(joining, periodEnd);
    const factor = eligible / total;
    days = periodDays * factor;
    breakdown.push({
      rule: "prorate_joining",
      detail: `Joined ${joining}; ${eligible} of ${total} days of the leave year`,
      effect: `× ${Math.round(factor * 100)}%`,
    });
  }

  const exit = asDateString(exitDate);
  if (allocation.prorateOnExit && exit && exit < periodEnd) {
    const total = dt.daysBetween(periodStart, periodEnd);
    const start = joining && joining > periodStart ? joining : periodStart;
    const eligible = dt.daysBetween(start, exit);
    const factor = eligible / total;
    days = periodDays * factor;
    breakdown.push({
      rule: "prorate_exit",
      detail: `Last working day ${exit}`,
      effect: `× ${Math.round(factor * 100)}%`,
    });
  }

  const rounded = applyRounding(days, allocation.rounding);
  if (rounded !== days) {
    breakdown.push({
      rule: "rounding",
      detail: `${round2(days)} rounded (${allocation.rounding})`,
      effect: `${rounded} days`,
    });
  }

  let final = rounded;
  if (allocation.maximumBalance > 0 && final > allocation.maximumBalance) {
    breakdown.push({
      rule: "maximum_balance",
      detail: `Capped at ${allocation.maximumBalance}`,
      effect: `${allocation.maximumBalance} days`,
    });
    final = allocation.maximumBalance;
  }

  return { days: final, breakdown };
}

/** Accept a Date or a "YYYY-MM-DD" string; always return the string form. */
function asDateString(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const text = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function applyRounding(value, mode) {
  switch (mode) {
    case "up":
      return Math.ceil(value);
    case "down":
      return Math.floor(value);
    case "nearest_whole":
      return Math.round(value);
    case "nearest_half":
      return Math.round(value * 2) / 2;
    case "none":
    default:
      return round2(value);
  }
}

/** Carry forward at year end, capped by the policy. */
function computeCarryForward({ rule, closingBalance }) {
  const cf = rule.carryForward || {};
  if (!cf.enabled) {
    return {
      carried: 0,
      lapsed: Math.max(0, closingBalance),
      breakdown: [
        { rule: "carry_forward", detail: "Not enabled for this leave type", effect: `${Math.max(0, closingBalance)} days lapse` },
      ],
    };
  }

  const available = Math.max(0, closingBalance);
  const carried = cf.maximumDays > 0 ? Math.min(available, cf.maximumDays) : available;
  const lapsed = round2(available - carried);

  return {
    carried: round2(carried),
    lapsed,
    breakdown: [
      {
        rule: "carry_forward",
        detail:
          cf.maximumDays > 0
            ? `${available} available, capped at ${cf.maximumDays}`
            : `${available} carried in full`,
        effect: `${round2(carried)} carried, ${lapsed} lapsed`,
      },
    ],
  };
}

/**
 * Validate a request against the rule's application constraints.
 * @returns {string[]} human-readable problems; empty means it is allowed
 */
function checkApplicationRules({ rule, leaveDays, fromDate, today, balanceAvailable, requestsThisYear }) {
  const app = (rule && rule.application) || {};
  const problems = [];

  if (app.minimumDaysPerRequest && leaveDays < app.minimumDaysPerRequest) {
    problems.push(`The minimum you can apply for is ${app.minimumDaysPerRequest} day(s).`);
  }
  if (app.maximumDaysPerRequest > 0 && leaveDays > app.maximumDaysPerRequest) {
    problems.push(`The maximum per request is ${app.maximumDaysPerRequest} day(s).`);
  }
  if (app.maximumRequestsPerYear > 0 && requestsThisYear >= app.maximumRequestsPerYear) {
    problems.push(`You have used all ${app.maximumRequestsPerYear} requests allowed this year for this leave type.`);
  }

  if (fromDate < today) {
    if (!app.allowBackdated) {
      problems.push("Backdated applications are not allowed for this leave type.");
    } else if (app.backdatedLimitDays > 0) {
      const earliest = dt.addDays(today, -app.backdatedLimitDays);
      if (fromDate < earliest) {
        problems.push(`Backdated applications are limited to ${app.backdatedLimitDays} days.`);
      }
    }
  } else if (app.noticeDays > 0) {
    const noticeGiven = dt.daysBetween(today, fromDate) - 1;
    if (noticeGiven < app.noticeDays) {
      problems.push(
        `This leave type needs ${app.noticeDays} day(s) of notice; you have given ${Math.max(0, noticeGiven)}.`
      );
    }
  }

  const shortfall = round2(leaveDays - balanceAvailable);
  if (shortfall > 0) {
    if (!app.allowNegativeBalance) {
      problems.push(
        `You have ${balanceAvailable} day(s) available and this request needs ${leaveDays}.`
      );
    } else if (app.maximumNegativeDays > 0 && shortfall > app.maximumNegativeDays) {
      problems.push(
        `This would take your balance ${shortfall} days negative; the limit is ${app.maximumNegativeDays}.`
      );
    }
  }

  return problems;
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

module.exports = {
  computeDays,
  checkEligibility,
  computeAllocation,
  computeCarryForward,
  checkApplicationRules,
  applyRounding,
  asDateString,
  PORTION_VALUE,
};
