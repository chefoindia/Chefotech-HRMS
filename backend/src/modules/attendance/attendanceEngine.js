"use strict";

const {
  minutesBetween,
  resolveShiftWindow,
  formatMinutes,
  timeToMinutes,
} = require("../../shared/datetime");

/**
 * The attendance calculation engine.
 *
 * A pure function. No database, no clock, no tenant context — everything it
 * needs is passed in, and the same inputs always produce the same output.
 * That is what makes attendance testable, reproducible when a payroll dispute
 * comes up eight months later, and safe to re-run over historical data after a
 * policy correction.
 *
 * It also returns a `breakdown`: an ordered list of the rules that fired and
 * what each contributed. When an employee asks "why am I marked half day on
 * the 12th", the answer is in the record, not in someone's reasoning.
 */

const STATUS = {
  PRESENT: "present",
  ABSENT: "absent",
  HALF_DAY: "half_day",
  WEEKLY_OFF: "weekly_off",
  HOLIDAY: "holiday",
  LEAVE: "leave",
  ON_DUTY: "on_duty",
  WORK_FROM_HOME: "work_from_home",
  COMP_OFF: "comp_off",
  PENDING: "pending",
  NOT_APPLICABLE: "not_applicable",
};

/**
 * @typedef {Object} EngineInput
 * @property {string} date              "YYYY-MM-DD"
 * @property {string} timezone          the organization's or location's zone
 * @property {Array}  punches           [{ at: Date, direction: "in"|"out"|null, source }]
 * @property {Object|null} shift        resolved Shift document
 * @property {Object} policy            resolved AttendancePolicy document
 * @property {Object|null} holiday      resolved Holiday, if any
 * @property {Object} weeklyOff         { isOff, isHalfDay, session }
 * @property {Object|null} leave        { type, dayPortion: "full"|"first_half"|"second_half", isPaid }
 * @property {Object|null} override     manual HR entry that wins over punches
 * @property {number} [lateMarkCount]   late marks already accumulated this period
 */

/**
 * @param {EngineInput} input
 * @returns {Object} the computed attendance record fields plus a breakdown
 */
function calculate(input) {
  const {
    date,
    timezone,
    punches = [],
    shift = null,
    policy,
    holiday = null,
    weeklyOff = { isOff: false, isHalfDay: false },
    leave = null,
    override = null,
    lateMarkCount = 0,
  } = input;

  const breakdown = [];
  const note = (rule, detail, effect) => breakdown.push({ rule, detail, effect });

  const result = {
    date,
    status: STATUS.ABSENT,
    shiftId: shift ? shift._id : null,
    shiftCode: shift ? shift.code : null,
    scheduledStart: null,
    scheduledEnd: null,
    scheduledMinutes: 0,

    firstPunchAt: null,
    lastPunchAt: null,
    punchCount: punches.length,

    workedMinutes: 0,
    breakMinutes: 0,
    effectiveMinutes: 0,

    lateByMinutes: 0,
    earlyLeavingByMinutes: 0,
    overtimeMinutes: 0,

    isLate: false,
    isEarlyLeaving: false,
    isMissingPunch: false,
    isHoliday: Boolean(holiday),
    isWeeklyOff: Boolean(weeklyOff.isOff),

    payableDays: 0,
    compOffEarnedDays: 0,
    lateMarkApplied: false,

    breakdown,
  };

  // ── 0. Manual override wins over everything ───────────────────────────────
  if (override && override.status) {
    note("manual_override", `Set to ${override.status} by HR`, "status");
    return {
      ...result,
      ...applyOverride(override, result),
      status: override.status,
      isManualOverride: true,
    };
  }

  const sortedPunches = [...punches].sort((a, b) => new Date(a.at) - new Date(b.at));
  const hasPunches = sortedPunches.length > 0;

  if (hasPunches) {
    result.firstPunchAt = sortedPunches[0].at;
    result.lastPunchAt = sortedPunches[sortedPunches.length - 1].at;
  }

  // ── 1. Shift window ───────────────────────────────────────────────────────
  let window = null;
  if (shift && shift.type !== "flexible") {
    window = resolveShiftWindow(date, shift.startTime, shift.endTime, timezone);
    result.scheduledStart = window.start;
    result.scheduledEnd = window.end;
    result.scheduledMinutes = shiftDurationMinutes(shift);
    if (window.crossesMidnight) {
      note(
        "night_shift",
        `${shift.startTime}–${shift.endTime} runs into the next day`,
        "shift_window"
      );
    }
  } else if (shift) {
    result.scheduledMinutes = shift.flexibleMinimumMinutes || 480;
    note("flexible_shift", `Requires ${formatMinutes(result.scheduledMinutes)} of work`, "shift_window");
  }

  // ── 2. Non-working days ───────────────────────────────────────────────────
  // Holiday and weekly off are resolved BEFORE leave, because an employee on
  // leave across a holiday should not have that day deducted from their
  // balance — that is the sandwich question, and it is answered here.
  if (holiday) {
    result.status = STATUS.HOLIDAY;
    result.holidayName = holiday.name;
    result.payableDays = 1;
    note("holiday", `${holiday.name}`, "non_working_day");

    if (!hasPunches) return finalise(result, policy);
    note("worked_on_holiday", "Punches recorded on a holiday", "overtime_eligible");
  } else if (weeklyOff.isOff) {
    result.status = STATUS.WEEKLY_OFF;
    result.payableDays = 1;
    note("weekly_off", "Scheduled weekly off", "non_working_day");

    if (!hasPunches) return finalise(result, policy);
    note("worked_on_weekly_off", "Punches recorded on a weekly off", "overtime_eligible");
  }

  // ── 3. Approved leave ─────────────────────────────────────────────────────
  if (leave && !holiday && !weeklyOff.isOff) {
    if (leave.dayPortion === "full") {
      result.status = STATUS.LEAVE;
      result.leaveType = leave.type;
      result.payableDays = leave.isPaid ? 1 : 0;
      note("on_leave", `${leave.type} (full day)`, "status");
      if (!hasPunches) return finalise(result, policy);
    } else {
      // Half-day leave: the other half is still expected to be worked.
      result.leaveType = leave.type;
      result.leavePortion = leave.dayPortion;
      result.payableDays = leave.isPaid ? 0.5 : 0;
      note("half_day_leave", `${leave.type} (${leave.dayPortion.replace("_", " ")})`, "half_expected");
    }
  }

  // ── 4. No punches on a working day ────────────────────────────────────────
  if (!hasPunches) {
    if (result.status === STATUS.LEAVE) return finalise(result, policy);
    result.status = STATUS.ABSENT;
    result.payableDays = 0;
    note("no_punches", "No attendance recorded", "absent");
    return finalise(result, policy);
  }

  // ── 5. Worked minutes ─────────────────────────────────────────────────────
  const worked = computeWorkedMinutes(sortedPunches, shift, policy);
  result.workedMinutes = worked.workedMinutes;
  result.breakMinutes = worked.breakMinutes;
  result.sessions = worked.sessions;
  result.isMissingPunch = worked.missingPunch;

  note(
    "worked_time",
    `${formatMinutes(worked.workedMinutes)} across ${worked.sessions.length} session${worked.sessions.length === 1 ? "" : "s"}` +
      (worked.breakMinutes ? `, ${formatMinutes(worked.breakMinutes)} break` : ""),
    "worked_minutes"
  );

  if (worked.missingPunch) {
    note("missing_punch", "An odd number of punches was recorded", "flagged");
  }

  // Deduct break time beyond the allowance.
  let effective = worked.workedMinutes;
  if (policy.breaks.deductExcessBreak && worked.breakMinutes > policy.breaks.maxBreakMinutes) {
    const excess = worked.breakMinutes - policy.breaks.maxBreakMinutes;
    effective -= excess;
    note(
      "excess_break",
      `Break of ${formatMinutes(worked.breakMinutes)} exceeded the ${formatMinutes(policy.breaks.maxBreakMinutes)} allowance`,
      `-${formatMinutes(excess)}`
    );
  }
  result.effectiveMinutes = Math.max(0, effective);

  // ── 6. Non-working day with work: overtime or comp off, then stop ─────────
  if (result.status === STATUS.HOLIDAY || result.status === STATUS.WEEKLY_OFF) {
    const isHoliday = result.status === STATUS.HOLIDAY;
    const config = isHoliday ? policy.holiday : policy.weeklyOff;

    if (config.countsAsOvertime && policy.overtime.enabled) {
      result.overtimeMinutes = roundOvertime(result.effectiveMinutes, policy);
      result.overtimeRate = isHoliday ? policy.overtime.holidayRate : policy.overtime.weeklyOffRate;
      note(
        "overtime",
        `${formatMinutes(result.overtimeMinutes)} at ${result.overtimeRate}x`,
        "overtime"
      );
    }

    if (config.grantsCompOff) {
      const full = policy.weeklyOff.compOffFullDayMinutes;
      const half = policy.weeklyOff.compOffHalfDayMinutes;
      if (result.effectiveMinutes >= full) {
        result.compOffEarnedDays = 1;
        note("comp_off", `Worked ${formatMinutes(result.effectiveMinutes)} — 1 day earned`, "comp_off");
      } else if (result.effectiveMinutes >= half) {
        result.compOffEarnedDays = 0.5;
        note("comp_off", `Worked ${formatMinutes(result.effectiveMinutes)} — half day earned`, "comp_off");
      }
    }

    return finalise(result, policy);
  }

  // ── 7. Late arrival ───────────────────────────────────────────────────────
  if (window && shift.type !== "flexible") {
    const lateBy = minutesBetween(window.start, result.firstPunchAt);
    const afterGrace = Math.max(0, lateBy - policy.arrival.graceMinutes);

    if (lateBy > 0 && afterGrace === 0) {
      note("grace_period", `${lateBy} min late, within the ${policy.arrival.graceMinutes} min grace`, "forgiven");
    }

    if (afterGrace > policy.arrival.lateAfterMinutes) {
      result.isLate = true;
      result.lateByMinutes = afterGrace;
      note(
        "late_arrival",
        `Arrived ${formatMinutes(afterGrace)} after grace (shift starts ${shift.startTime})`,
        "late_mark"
      );
    }
  }

  // ── 8. Early leaving ──────────────────────────────────────────────────────
  if (window && shift.type !== "flexible" && !result.isMissingPunch) {
    const earlyBy = minutesBetween(result.lastPunchAt, window.end);
    const afterGrace = Math.max(0, earlyBy - policy.departure.graceMinutes);
    if (afterGrace > policy.departure.earlyLeavingAfterMinutes) {
      result.isEarlyLeaving = true;
      result.earlyLeavingByMinutes = afterGrace;
      note(
        "early_leaving",
        `Left ${formatMinutes(afterGrace)} before shift end (${shift.endTime})`,
        "early_mark"
      );
    }
  }

  // ── 9. Day classification ─────────────────────────────────────────────────
  const thresholds = resolveThresholds(policy, result.scheduledMinutes);
  note(
    "thresholds",
    `Full day ≥ ${formatMinutes(thresholds.full)}, half day ≥ ${formatMinutes(thresholds.half)}`,
    "reference"
  );

  // A missing punch is resolved BEFORE the hours are judged. Someone who
  // clocked in and forgot to clock out has no measurable worked time, so
  // testing their hours first would silently mark every one of them absent
  // and bypass the policy's missing-punch setting entirely.
  if (result.isMissingPunch) {
    const treatment = policy.missingPunch.treatAs;
    if (treatment === "present") {
      result.status = STATUS.PRESENT;
      result.payableDays = 1;
    } else {
      result.status =
        treatment === "absent"
          ? STATUS.ABSENT
          : treatment === "half_day"
            ? STATUS.HALF_DAY
            : STATUS.PENDING;
      result.payableDays = treatment === "half_day" ? 0.5 : 0;
    }
    note(
      "missing_punch_policy",
      `A punch is missing, and the policy treats that as ${treatment.replace(/_/g, " ")}`,
      "status"
    );
  } else if (result.effectiveMinutes < policy.hours.minimumMinutesForPresence) {
    result.status = STATUS.ABSENT;
    result.payableDays = 0;
    note(
      "below_minimum",
      `${formatMinutes(result.effectiveMinutes)} is under the ${formatMinutes(policy.hours.minimumMinutesForPresence)} minimum`,
      "absent"
    );
  } else if (result.effectiveMinutes >= thresholds.full) {
    result.status = STATUS.PRESENT;
    result.payableDays = 1;
    note("full_day", `${formatMinutes(result.effectiveMinutes)} meets the full-day threshold`, "present");
  } else if (result.effectiveMinutes >= thresholds.half) {
    result.status = STATUS.HALF_DAY;
    result.payableDays = 0.5;
    note("half_day", `${formatMinutes(result.effectiveMinutes)} meets only the half-day threshold`, "half_day");
  } else {
    result.status = STATUS.ABSENT;
    result.payableDays = 0;
    note("insufficient_hours", `${formatMinutes(result.effectiveMinutes)} is below the half-day threshold`, "absent");
  }

  // Arriving extremely late can downgrade a day that otherwise had the hours,
  // which is how a company enforces punctuality on a shift floor.
  if (result.isLate && result.status === STATUS.PRESENT) {
    if (policy.arrival.absentAfterMinutes > 0 && result.lateByMinutes >= policy.arrival.absentAfterMinutes) {
      result.status = STATUS.ABSENT;
      result.payableDays = 0;
      note("late_absent_rule", `Late by ${formatMinutes(result.lateByMinutes)}`, "downgraded_to_absent");
    } else if (policy.arrival.halfDayAfterMinutes > 0 && result.lateByMinutes >= policy.arrival.halfDayAfterMinutes) {
      result.status = STATUS.HALF_DAY;
      result.payableDays = 0.5;
      note("late_half_day_rule", `Late by ${formatMinutes(result.lateByMinutes)}`, "downgraded_to_half_day");
    }
  }

  if (result.isEarlyLeaving && result.status === STATUS.PRESENT) {
    if (
      policy.departure.halfDayBeforeMinutes > 0 &&
      result.earlyLeavingByMinutes >= policy.departure.halfDayBeforeMinutes
    ) {
      result.status = STATUS.HALF_DAY;
      result.payableDays = 0.5;
      note(
        "early_leaving_half_day_rule",
        `Left ${formatMinutes(result.earlyLeavingByMinutes)} early`,
        "downgraded_to_half_day"
      );
    }
  }

  // ── 10. Half-day leave interaction ────────────────────────────────────────
  if (result.leavePortion) {
    // Half the day was leave; the other half was expected. Present for that
    // half means a full payable day between the two.
    //
    // The comparison uses GROSS time on site rather than the break-adjusted
    // figure: the shift's nominal break belongs to the whole day, and
    // deducting a full lunch hour from a four-hour half day would fail
    // someone who worked their entire half.
    const grossOnSite = result.workedMinutes + result.breakMinutes;
    const workedHalf = grossOnSite >= thresholds.half;

    result.payableDays = (leave.isPaid ? 0.5 : 0) + (workedHalf ? 0.5 : 0);
    result.status = workedHalf ? STATUS.HALF_DAY : STATUS.ABSENT;
    note(
      "half_day_leave_combined",
      `${leave.dayPortion.replace(/_/g, " ")} on leave; ${formatMinutes(grossOnSite)} on site against a ${formatMinutes(thresholds.half)} half-day threshold`,
      `${result.payableDays} payable day(s)`
    );
  }

  // ── 11. Late-mark accumulation ────────────────────────────────────────────
  if (result.isLate && policy.lateMarks.enabled) {
    const total = lateMarkCount + 1;
    result.lateMarkNumber = total;
    if (total % policy.lateMarks.countForDeduction === 0) {
      result.lateMarkApplied = true;
      if (policy.lateMarks.deductionType === "half_day" && result.payableDays > 0.5) {
        result.payableDays -= 0.5;
      } else if (policy.lateMarks.deductionType === "full_day") {
        result.payableDays = Math.max(0, result.payableDays - 1);
      }
      note(
        "late_mark_deduction",
        `Late mark ${total} of every ${policy.lateMarks.countForDeduction}`,
        `-${policy.lateMarks.deductionType === "full_day" ? "1 day" : "0.5 day"}`
      );
    } else {
      note("late_mark", `Late mark ${total}; ${policy.lateMarks.countForDeduction - (total % policy.lateMarks.countForDeduction)} more before a deduction`, "counted");
    }
  }

  // ── 12. Overtime on a normal working day ──────────────────────────────────
  if (policy.overtime.enabled && window && !result.isMissingPunch) {
    const past = minutesBetween(window.end, result.lastPunchAt);
    let overtime = Math.max(0, past - policy.overtime.startsAfterMinutes);

    if (policy.arrival.earlyArrivalCountsAsOvertime) {
      const early = minutesBetween(result.firstPunchAt, window.start);
      if (early > policy.overtime.startsAfterMinutes) {
        overtime += early - policy.overtime.startsAfterMinutes;
      }
    }

    const rounded = roundOvertime(overtime, policy);
    if (rounded > 0) {
      result.overtimeMinutes = rounded;
      result.overtimeRate = policy.overtime.normalDayRate;
      result.overtimeRequiresApproval = policy.overtime.requiresApproval;
      note(
        "overtime",
        `${formatMinutes(rounded)} beyond shift end at ${policy.overtime.normalDayRate}x` +
          (policy.overtime.requiresApproval ? " (needs approval)" : ""),
        "overtime"
      );
    }
  }

  return finalise(result, policy);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function shiftDurationMinutes(shift) {
  if (!shift) return 480;
  if (shift.type === "flexible") return shift.flexibleMinimumMinutes || 480;
  const start = timeToMinutes(shift.startTime);
  const end = timeToMinutes(shift.endTime);
  const gross = end > start ? end - start : 1440 - start + end;
  return shift.isBreakPaid ? gross : gross - (shift.breakMinutes || 0);
}

function resolveThresholds(policy, scheduledMinutes) {
  if (policy.hours.basis === "fixed_hours") {
    return { full: policy.hours.fullDayMinutes, half: policy.hours.halfDayMinutes };
  }
  const base = scheduledMinutes || 480;
  return {
    full: Math.round((base * policy.hours.fullDayPercent) / 100),
    half: Math.round((base * policy.hours.halfDayPercent) / 100),
  };
}

/**
 * Turn punches into worked minutes.
 *
 * `first_last` is what most companies mean by a working day and is resilient
 * to the extra punches a biometric device produces when someone taps twice.
 * `paired` is stricter and used where break tracking matters.
 */
function computeWorkedMinutes(punches, shift, policy) {
  const sessions = [];
  let breakMinutes = 0;
  let missingPunch = false;

  if (punches.length === 1) {
    return { workedMinutes: 0, breakMinutes: 0, sessions: [], missingPunch: true };
  }

  if (policy.breaks.calculation === "first_last") {
    const start = punches[0].at;
    const end = punches[punches.length - 1].at;
    const gross = minutesBetween(start, end);
    const nominalBreak = shift && !shift.isBreakPaid ? shift.breakMinutes || 0 : 0;
    sessions.push({ in: start, out: end, minutes: gross });
    return {
      workedMinutes: Math.max(0, gross - nominalBreak),
      breakMinutes: nominalBreak,
      sessions,
      missingPunch: false,
    };
  }

  // Paired: alternate in/out, using the recorded direction where the device
  // provides one and falling back to strict alternation where it does not.
  let openAt = null;
  let previousOut = null;

  for (const punch of punches) {
    const direction = punch.direction || (openAt ? "out" : "in");
    if (direction === "in") {
      if (openAt) continue; // duplicate in; ignore rather than double-count
      if (previousOut) breakMinutes += minutesBetween(previousOut, punch.at);
      openAt = punch.at;
    } else {
      if (!openAt) continue; // an out with no in
      sessions.push({ in: openAt, out: punch.at, minutes: minutesBetween(openAt, punch.at) });
      previousOut = punch.at;
      openAt = null;
    }
  }

  if (openAt) missingPunch = true;

  return {
    workedMinutes: sessions.reduce((sum, s) => sum + s.minutes, 0),
    breakMinutes,
    sessions,
    missingPunch,
  };
}

function roundOvertime(minutes, policy) {
  const ot = policy.overtime;
  if (minutes < ot.minimumMinutes) return 0;
  let value = Math.min(minutes, ot.maximumMinutesPerDay);
  if (ot.roundToMinutes > 0) {
    value = Math.floor(value / ot.roundToMinutes) * ot.roundToMinutes;
  }
  return value;
}

function applyOverride(override, base) {
  const payableByStatus = {
    [STATUS.PRESENT]: 1,
    [STATUS.HALF_DAY]: 0.5,
    [STATUS.ABSENT]: 0,
    [STATUS.HOLIDAY]: 1,
    [STATUS.WEEKLY_OFF]: 1,
    [STATUS.ON_DUTY]: 1,
    [STATUS.WORK_FROM_HOME]: 1,
    [STATUS.COMP_OFF]: 1,
    [STATUS.LEAVE]: 1,
  };
  return {
    payableDays: override.payableDays !== undefined ? override.payableDays : payableByStatus[override.status] || 0,
    workedMinutes: override.workedMinutes !== undefined ? override.workedMinutes : base.workedMinutes,
    effectiveMinutes: override.workedMinutes !== undefined ? override.workedMinutes : base.effectiveMinutes,
    overtimeMinutes: override.overtimeMinutes || 0,
    overrideReason: override.reason || "",
  };
}

function finalise(result, policy) {
  // Overtime that needs approval is not payable until it is approved.
  if (result.overtimeMinutes > 0 && policy.overtime.requiresApproval) {
    result.overtimeStatus = "pending";
  } else if (result.overtimeMinutes > 0) {
    result.overtimeStatus = "approved";
  }
  result.workedHoursLabel = formatMinutes(result.effectiveMinutes || result.workedMinutes);
  return result;
}

module.exports = { calculate, STATUS, resolveThresholds, computeWorkedMinutes, shiftDurationMinutes };
