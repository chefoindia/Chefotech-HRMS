"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const engine = require("../../src/modules/attendance/attendanceEngine");
const fixtures = require("../helpers/fixtures");
const dt = require("../../src/shared/datetime");

const TZ = fixtures.TZ;
const DATE = "2026-08-20"; // a Thursday

function calculate(overrides = {}) {
  return engine.calculate({
    date: DATE,
    timezone: TZ,
    punches: [],
    shift: fixtures.shift(),
    policy: fixtures.attendancePolicy(),
    holiday: null,
    weeklyOff: { isOff: false, isHalfDay: false },
    leave: null,
    override: null,
    lateMarkCount: 0,
    ...overrides,
  });
}

// ── Basic classification ────────────────────────────────────────────────────

test("a full day of work is present and fully payable", () => {
  const result = calculate({ punches: fixtures.punches(DATE, ["09:00", "18:00"]) });

  assert.equal(result.status, "present");
  assert.equal(result.payableDays, 1);
  assert.equal(result.effectiveMinutes, 480, "9 hours less the 1 hour unpaid break");
  assert.equal(result.isLate, false);
});

test("no punches on a working day is an absence", () => {
  const result = calculate();
  assert.equal(result.status, "absent");
  assert.equal(result.payableDays, 0);
  assert.ok(result.breakdown.some((b) => b.rule === "no_punches"));
});

test("too few hours makes it a half day", () => {
  // 09:00–14:00 is 5h gross, 4h net of break. Half-day threshold is 45% of
  // 480 = 216 minutes; full day is 432.
  const result = calculate({ punches: fixtures.punches(DATE, ["09:00", "14:00"]) });

  assert.equal(result.status, "half_day");
  assert.equal(result.payableDays, 0.5);
});

test("barely any time on site is an absence, not a half day", () => {
  const result = calculate({ punches: fixtures.punches(DATE, ["09:00", "09:30"]) });
  assert.equal(result.status, "absent");
  assert.ok(result.breakdown.some((b) => b.rule === "below_minimum"));
});

// ── Grace and lateness ──────────────────────────────────────────────────────

test("arriving within the grace period is not late", () => {
  const result = calculate({ punches: fixtures.punches(DATE, ["09:08", "18:10"]) });

  assert.equal(result.isLate, false);
  assert.equal(result.status, "present");
  assert.ok(result.breakdown.some((b) => b.rule === "grace_period"));
});

test("arriving past the grace period is late, counted after grace", () => {
  const result = calculate({ punches: fixtures.punches(DATE, ["09:25", "18:30"]) });

  assert.equal(result.isLate, true);
  assert.equal(result.lateByMinutes, 15, "25 minutes late, minus 10 minutes of grace");
});

test("the grace period is configuration, not a constant", () => {
  const strict = calculate({
    punches: fixtures.punches(DATE, ["09:08", "18:00"]),
    policy: fixtures.attendancePolicy({ arrival: { graceMinutes: 5 } }),
  });
  const lenient = calculate({
    punches: fixtures.punches(DATE, ["09:08", "18:00"]),
    policy: fixtures.attendancePolicy({ arrival: { graceMinutes: 15 } }),
  });

  assert.equal(strict.isLate, true, "8 minutes late against a 5 minute grace");
  assert.equal(lenient.isLate, false, "same punch, 15 minute grace");
});

test("arriving extremely late downgrades a full day to a half day", () => {
  // In at 13:30, out at 22:00 — enough hours for a full day, but more than
  // four hours after the shift started.
  const result = calculate({
    punches: fixtures.punches(DATE, ["13:30", "22:00"]),
    policy: fixtures.attendancePolicy({ arrival: { halfDayAfterMinutes: 240 } }),
  });

  assert.equal(result.status, "half_day");
  assert.ok(result.breakdown.some((b) => b.rule === "late_half_day_rule"));
});

// ── Night shifts ────────────────────────────────────────────────────────────

test("a night shift that crosses midnight is measured correctly", () => {
  const night = fixtures.shift({ code: "NGT", startTime: "22:00", endTime: "06:00", breakMinutes: 45 });
  assert.equal(night.crossesMidnight, true);

  const result = calculate({
    shift: night,
    punches: fixtures.punches(DATE, ["22:00", "06:00"]),
  });

  assert.equal(result.status, "present");
  assert.equal(result.effectiveMinutes, 435, "8 hours less a 45 minute break");
  assert.ok(result.breakdown.some((b) => b.rule === "night_shift"));
  assert.equal(
    dt.toDateString(result.scheduledEnd, TZ),
    "2026-08-21",
    "the shift ends on the following calendar day"
  );
});

test("a night worker arriving late is late, not absent", () => {
  const night = fixtures.shift({ startTime: "22:00", endTime: "06:00", breakMinutes: 45 });
  const result = calculate({
    shift: night,
    punches: fixtures.punches(DATE, ["22:40", "06:00"]),
  });

  assert.equal(result.isLate, true);
  assert.equal(result.lateByMinutes, 30);
  assert.equal(result.status, "present");
});

// ── Holidays, weekly offs and leave ─────────────────────────────────────────

test("a holiday with no work is paid and not an absence", () => {
  const result = calculate({ holiday: { name: "Onam", isPaid: true } });

  assert.equal(result.status, "holiday");
  assert.equal(result.payableDays, 1);
  assert.equal(result.holidayName, "Onam");
});

test("working on a weekly off earns comp off when the policy grants it", () => {
  const result = calculate({
    weeklyOff: { isOff: true, isHalfDay: false },
    punches: fixtures.punches(DATE, ["09:00", "18:00"]),
    policy: fixtures.attendancePolicy({
      weeklyOff: { grantsCompOff: true, compOffFullDayMinutes: 480 },
    }),
  });

  assert.equal(result.status, "weekly_off");
  assert.equal(result.compOffEarnedDays, 1);
  assert.equal(result.payableDays, 1);
});

test("a half day of work on a weekly off earns half a comp off", () => {
  const result = calculate({
    weeklyOff: { isOff: true, isHalfDay: false },
    punches: fixtures.punches(DATE, ["09:00", "14:00"]),
    policy: fixtures.attendancePolicy({
      weeklyOff: { grantsCompOff: true, compOffFullDayMinutes: 480, compOffHalfDayMinutes: 240 },
    }),
  });

  assert.equal(result.compOffEarnedDays, 0.5);
});

test("approved full-day leave is paid and needs no punches", () => {
  const result = calculate({
    leave: { type: "Casual Leave", dayPortion: "full", isPaid: true },
  });

  assert.equal(result.status, "leave");
  assert.equal(result.payableDays, 1);
  assert.equal(result.leaveType, "Casual Leave");
});

test("unpaid leave is recorded but not payable", () => {
  const result = calculate({
    leave: { type: "Loss of Pay", dayPortion: "full", isPaid: false },
  });

  assert.equal(result.status, "leave");
  assert.equal(result.payableDays, 0);
});

test("half-day leave plus a worked half day makes a full payable day", () => {
  const result = calculate({
    leave: { type: "Casual Leave", dayPortion: "first_half", isPaid: true },
    punches: fixtures.punches(DATE, ["13:30", "18:00"]),
  });

  assert.equal(result.payableDays, 1, "0.5 from leave plus 0.5 from the worked half");
  assert.equal(result.status, "half_day");
});

test("half-day leave with no work is only half payable", () => {
  const result = calculate({
    leave: { type: "Casual Leave", dayPortion: "first_half", isPaid: true },
    punches: fixtures.punches(DATE, ["16:30", "17:00"]),
  });

  assert.equal(result.payableDays, 0.5);
  assert.equal(result.status, "absent");
});

// ── Overtime ────────────────────────────────────────────────────────────────

test("overtime accrues past the shift end and is rounded down", () => {
  const result = calculate({
    punches: fixtures.punches(DATE, ["09:00", "20:50"]),
    policy: fixtures.attendancePolicy({
      overtime: { enabled: true, startsAfterMinutes: 30, minimumMinutes: 30, roundToMinutes: 30 },
    }),
  });

  // 2h50 past 18:00, less the 30 minute threshold = 140 min, rounded down to 120.
  assert.equal(result.overtimeMinutes, 120);
  assert.equal(result.overtimeRate, 1.5);
  assert.equal(result.overtimeStatus, "pending", "approval is required by default");
});

test("overtime below the minimum is ignored", () => {
  const result = calculate({
    punches: fixtures.punches(DATE, ["09:00", "18:45"]),
    policy: fixtures.attendancePolicy({
      overtime: { enabled: true, startsAfterMinutes: 30, minimumMinutes: 30 },
    }),
  });

  assert.equal(result.overtimeMinutes, 0);
});

test("overtime is capped at the daily maximum", () => {
  const result = calculate({
    punches: fixtures.punches(DATE, ["09:00", "23:59"]),
    policy: fixtures.attendancePolicy({
      overtime: { enabled: true, startsAfterMinutes: 0, minimumMinutes: 30, maximumMinutesPerDay: 180, roundToMinutes: 30 },
    }),
  });

  assert.equal(result.overtimeMinutes, 180);
});

test("holiday work is paid at the holiday overtime rate", () => {
  const result = calculate({
    holiday: { name: "Onam", isPaid: true },
    punches: fixtures.punches(DATE, ["09:00", "18:00"]),
    policy: fixtures.attendancePolicy({
      overtime: { enabled: true, minimumMinutes: 30, roundToMinutes: 30, holidayRate: 2 },
      holiday: { countsAsOvertime: true, grantsCompOff: true },
    }),
  });

  assert.equal(result.overtimeRate, 2);
  assert.ok(result.overtimeMinutes > 0);
});

// ── Late marks ──────────────────────────────────────────────────────────────

test("the third late mark in a period costs half a day", () => {
  const policy = fixtures.attendancePolicy({
    lateMarks: { enabled: true, countForDeduction: 3, deductionType: "half_day" },
  });

  const second = calculate({
    punches: fixtures.punches(DATE, ["09:30", "18:30"]),
    policy,
    lateMarkCount: 1,
  });
  assert.equal(second.lateMarkApplied, false);
  assert.equal(second.payableDays, 1);

  const third = calculate({
    punches: fixtures.punches(DATE, ["09:30", "18:30"]),
    policy,
    lateMarkCount: 2,
  });
  assert.equal(third.lateMarkApplied, true);
  assert.equal(third.payableDays, 0.5);
  assert.equal(third.lateMarkNumber, 3);
});

// ── Missing punches ─────────────────────────────────────────────────────────

test("a single punch is flagged as a missing punch", () => {
  const result = calculate({ punches: fixtures.punches(DATE, ["09:00"]) });

  assert.equal(result.isMissingPunch, true);
  assert.equal(result.status, "pending", "the default policy asks a human to resolve it");
});

test("how a missing punch is treated is configurable", () => {
  const asHalfDay = calculate({
    punches: fixtures.punches(DATE, ["09:00"]),
    policy: fixtures.attendancePolicy({ missingPunch: { treatAs: "half_day" } }),
  });
  assert.equal(asHalfDay.status, "half_day");
  assert.equal(asHalfDay.payableDays, 0.5);

  const asAbsent = calculate({
    punches: fixtures.punches(DATE, ["09:00"]),
    policy: fixtures.attendancePolicy({ missingPunch: { treatAs: "absent" } }),
  });
  assert.equal(asAbsent.status, "absent");
});

// ── Break handling ──────────────────────────────────────────────────────────

test("paired mode measures each session and deducts the gaps", () => {
  const result = calculate({
    punches: fixtures.punches(DATE, ["09:00", "13:00", "14:30", "18:00"]),
    policy: fixtures.attendancePolicy({
      breaks: { calculation: "paired", maxBreakMinutes: 60, deductExcessBreak: true },
    }),
  });

  assert.equal(result.workedMinutes, 450, "4h + 3h30");
  assert.equal(result.breakMinutes, 90);
  assert.equal(result.effectiveMinutes, 420, "30 minutes of break beyond the 60 minute allowance");
});

test("a paid break is not deducted", () => {
  const result = calculate({
    shift: fixtures.shift({ breakMinutes: 60, isBreakPaid: true }),
    punches: fixtures.punches(DATE, ["09:00", "18:00"]),
  });

  assert.equal(result.effectiveMinutes, 540, "the full nine hours count");
});

// ── Determinism and explainability ──────────────────────────────────────────

test("every result carries a breakdown explaining it", () => {
  const result = calculate({ punches: fixtures.punches(DATE, ["09:25", "17:00"]) });

  assert.ok(result.breakdown.length > 3);
  for (const entry of result.breakdown) {
    assert.ok(entry.rule, "each breakdown entry names the rule that fired");
    assert.ok(entry.detail, "each entry explains itself in words");
  }
});

test("the same inputs always produce the same output", () => {
  const inputs = {
    punches: fixtures.punches(DATE, ["09:17", "18:42"]),
    policy: fixtures.attendancePolicy({
      overtime: { enabled: true, minimumMinutes: 15, roundToMinutes: 15 },
      lateMarks: { enabled: true },
    }),
    lateMarkCount: 1,
  };

  const first = calculate(inputs);
  for (let i = 0; i < 20; i += 1) {
    const again = calculate(inputs);
    assert.equal(again.status, first.status);
    assert.equal(again.payableDays, first.payableDays);
    assert.equal(again.effectiveMinutes, first.effectiveMinutes);
    assert.equal(again.overtimeMinutes, first.overtimeMinutes);
  }
});

test("a manual override wins over everything and says so", () => {
  const result = calculate({
    punches: fixtures.punches(DATE, ["09:00", "09:20"]),
    override: { status: "present", reason: "On client site, no device" },
  });

  assert.equal(result.status, "present");
  assert.equal(result.payableDays, 1);
  assert.equal(result.isManualOverride, true);
  assert.ok(result.breakdown.some((b) => b.rule === "manual_override"));
});

test("fixed-hour thresholds work independently of shift length", () => {
  const policy = fixtures.attendancePolicy({
    hours: { basis: "fixed_hours", fullDayMinutes: 300, halfDayMinutes: 150 },
  });

  const result = calculate({ punches: fixtures.punches(DATE, ["09:00", "15:00"]), policy });
  assert.equal(result.effectiveMinutes, 300);
  assert.equal(result.status, "present", "300 minutes meets the fixed 300 minute full day");
});
