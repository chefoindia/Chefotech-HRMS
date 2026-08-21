"use strict";

const dt = require("../../src/shared/datetime");

const TZ = "Asia/Kolkata";

/** A policy with the platform defaults, overridable per test. */
function attendancePolicy(overrides = {}) {
  const base = {
    arrival: {
      graceMinutes: 10,
      lateAfterMinutes: 0,
      halfDayAfterMinutes: 240,
      absentAfterMinutes: 0,
      earlyArrivalCountsAsOvertime: false,
    },
    departure: {
      graceMinutes: 10,
      earlyLeavingAfterMinutes: 0,
      halfDayBeforeMinutes: 240,
    },
    hours: {
      basis: "shift_based",
      fullDayMinutes: 480,
      halfDayMinutes: 240,
      fullDayPercent: 90,
      halfDayPercent: 45,
      minimumMinutesForPresence: 60,
    },
    breaks: { calculation: "first_last", maxBreakMinutes: 60, deductExcessBreak: true },
    lateMarks: { enabled: false, countForDeduction: 3, deductionType: "half_day", resetPeriod: "monthly" },
    overtime: {
      enabled: false,
      startsAfterMinutes: 30,
      minimumMinutes: 30,
      maximumMinutesPerDay: 240,
      roundToMinutes: 30,
      requiresApproval: true,
      normalDayRate: 1.5,
      weeklyOffRate: 2,
      holidayRate: 2,
    },
    weeklyOff: {
      grantsCompOff: false,
      compOffFullDayMinutes: 480,
      compOffHalfDayMinutes: 240,
      countsAsOvertime: true,
    },
    holiday: { grantsCompOff: true, countsAsOvertime: true },
    missingPunch: { treatAs: "pending", autoCloseAtShiftEnd: false, notifyEmployee: true },
    regularization: { enabled: true, windowDays: 7, maxPerMonth: 3, requiresApproval: true },
  };

  return deepMerge(base, overrides);
}

function shift(overrides = {}) {
  const base = {
    _id: "shift-general",
    code: "GEN",
    name: "General",
    type: "fixed",
    startTime: "09:00",
    endTime: "18:00",
    breakMinutes: 60,
    isBreakPaid: false,
    crossesMidnight: false,
    flexibleMinimumMinutes: 480,
  };
  const merged = { ...base, ...overrides };
  merged.crossesMidnight =
    dt.timeToMinutes(merged.endTime) <= dt.timeToMinutes(merged.startTime);
  return merged;
}

/** Build punches from "HH:mm" strings on a calendar date. */
function punches(date, times, { timezone = TZ, directions = null } = {}) {
  return times.map((time, index) => {
    // A time earlier than the previous one belongs to the next day, which is
    // how a night shift's exit punch is expressed.
    const previous = index > 0 ? dt.timeToMinutes(times[index - 1]) : -1;
    const onNextDay = dt.timeToMinutes(time) < previous;
    return {
      at: dt.combine(onNextDay ? dt.addDays(date, 1) : date, time, timezone),
      direction: directions ? directions[index] : index % 2 === 0 ? "in" : "out",
      source: "biometric",
    };
  });
}

function leaveRule(overrides = {}) {
  const base = {
    allocation: {
      mode: "annual",
      daysPerPeriod: 12,
      accrualPerMonth: 1,
      creditTiming: "advance",
      prorateOnJoining: true,
      prorateOnExit: true,
      rounding: "nearest_half",
      maximumBalance: 0,
    },
    carryForward: { enabled: false, maximumDays: 0, expiryMonths: 0 },
    encashment: { enabled: false, maximumDays: 0, minimumBalanceToRetain: 0, onExitOnly: true },
    application: {
      minimumDaysPerRequest: 0.5,
      maximumDaysPerRequest: 0,
      maximumRequestsPerYear: 0,
      noticeDays: 0,
      allowBackdated: true,
      backdatedLimitDays: 30,
      allowNegativeBalance: false,
      maximumNegativeDays: 0,
      maximumConcurrentInTeam: 0,
    },
    counting: { holidays: "exclude", weeklyOffs: "exclude" },
    approval: { required: true, escalateAfterDays: 0, autoApprove: false },
  };
  return deepMerge(base, overrides);
}

/** Calendar map for the leave engine: which dates are holidays / weekly offs. */
function calendar(dates, { weeklyOffDays = [0], holidays = {} } = {}) {
  const map = {};
  for (const date of dates) {
    map[date] = {
      isWeeklyOff: weeklyOffDays.includes(dt.weekdayIndex(date)),
      isHoliday: Boolean(holidays[date]),
      holidayName: holidays[date] || null,
    };
  }
  return map;
}

function salaryComponents() {
  return [
    {
      _id: "c-basic",
      code: "BASIC",
      name: "Basic",
      type: "earning",
      category: "basic",
      order: 10,
      prorateOnAttendance: true,
      includeInGross: true,
      showOnPayslip: true,
      calculation: { method: "formula", expression: "pct(CTC_MONTHLY, 40)", rounding: "nearest_1" },
    },
    {
      _id: "c-hra",
      code: "HRA",
      name: "HRA",
      type: "earning",
      category: "allowance",
      order: 20,
      prorateOnAttendance: true,
      includeInGross: true,
      showOnPayslip: true,
      calculation: { method: "formula", expression: "pct(BASIC, 50)", rounding: "nearest_1" },
    },
    {
      _id: "c-special",
      code: "SPECIAL",
      name: "Special Allowance",
      type: "earning",
      category: "allowance",
      order: 30,
      prorateOnAttendance: true,
      includeInGross: true,
      showOnPayslip: true,
      calculation: {
        method: "formula",
        expression: "max(CTC_MONTHLY - BASIC - HRA, 0)",
        rounding: "nearest_1",
      },
    },
    {
      _id: "c-pf",
      code: "PF",
      name: "Provident Fund",
      type: "deduction",
      category: "statutory",
      order: 100,
      prorateOnAttendance: true,
      includeInGross: false,
      showOnPayslip: true,
      calculation: { method: "formula", expression: "min(pct(BASIC, 12), 1800)", rounding: "nearest_1" },
    },
  ];
}

function payrollSettings(overrides = {}) {
  return {
    "payroll.working_days_basis": "calendar_days",
    "payroll.fixed_days_in_month": 30,
    "payroll.rounding": "nearest_1",
    "payroll.lop_from_attendance": true,
    ...overrides,
  };
}

function deepMerge(base, overrides) {
  const out = { ...base };
  for (const [key, value] of Object.entries(overrides || {})) {
    if (value && typeof value === "object" && !Array.isArray(value) && base[key]) {
      out[key] = deepMerge(base[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

module.exports = {
  TZ,
  attendancePolicy,
  shift,
  punches,
  leaveRule,
  calendar,
  salaryComponents,
  payrollSettings,
  deepMerge,
};
