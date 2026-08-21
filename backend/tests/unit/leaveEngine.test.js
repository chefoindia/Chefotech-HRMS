"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const engine = require("../../src/modules/leave/leaveEngine");
const fixtures = require("../helpers/fixtures");
const dt = require("../../src/shared/datetime");

/**
 * August 2026 for reference:
 *   Mon 17, Tue 18, Wed 19, Thu 20, Fri 21, Sat 22, Sun 23, Mon 24
 * Sunday is the weekly off in these tests unless stated otherwise.
 */

function computeDays({ fromDate, toDate, rule, holidays = {}, weeklyOffDays = [0], ...rest }) {
  const dates = dt.eachDate(fromDate, toDate);
  return engine.computeDays({
    fromDate,
    toDate,
    rule,
    calendar: fixtures.calendar(dates, { weeklyOffDays, holidays }),
    ...rest,
  });
}

// ── Day counting ────────────────────────────────────────────────────────────

test("a run of working days deducts one day each", () => {
  const result = computeDays({
    fromDate: "2026-08-17",
    toDate: "2026-08-19",
    rule: fixtures.leaveRule(),
  });

  assert.equal(result.calendarDays, 3);
  assert.equal(result.leaveDays, 3);
});

test("a half day at the start deducts half", () => {
  const result = computeDays({
    fromDate: "2026-08-17",
    toDate: "2026-08-18",
    fromPortion: "second_half",
    rule: fixtures.leaveRule(),
  });

  assert.equal(result.leaveDays, 1.5);
});

test("a single half day deducts 0.5", () => {
  const result = computeDays({
    fromDate: "2026-08-17",
    toDate: "2026-08-17",
    fromPortion: "first_half",
    rule: fixtures.leaveRule(),
  });

  assert.equal(result.leaveDays, 0.5);
});

// ── The sandwich rule ───────────────────────────────────────────────────────

test("exclude: a weekend inside the range is free", () => {
  // Friday 21 to Monday 24, with Sunday 23 off.
  const result = computeDays({
    fromDate: "2026-08-21",
    toDate: "2026-08-24",
    rule: fixtures.leaveRule({ counting: { weeklyOffs: "exclude" } }),
  });

  assert.equal(result.calendarDays, 4);
  assert.equal(result.leaveDays, 3, "Sunday is not deducted");
});

test("include: every calendar day is deducted", () => {
  const result = computeDays({
    fromDate: "2026-08-21",
    toDate: "2026-08-24",
    rule: fixtures.leaveRule({ counting: { weeklyOffs: "include" } }),
  });

  assert.equal(result.leaveDays, 4);
});

test("sandwich: a day off surrounded by leave is deducted", () => {
  const result = computeDays({
    fromDate: "2026-08-21",
    toDate: "2026-08-24",
    rule: fixtures.leaveRule({ counting: { weeklyOffs: "sandwich" } }),
  });

  assert.equal(result.leaveDays, 4, "Sunday sits between Saturday and Monday leave");
  assert.ok(result.breakdown.some((b) => b.rule === "sandwich_rule"));
});

test("sandwich: a day off at the edge of the range is NOT deducted", () => {
  // Sunday 23 to Tuesday 25 — the Sunday is the first day, with no leave
  // before it, so it is not sandwiched.
  const result = computeDays({
    fromDate: "2026-08-23",
    toDate: "2026-08-25",
    rule: fixtures.leaveRule({ counting: { weeklyOffs: "sandwich" } }),
  });

  assert.equal(result.leaveDays, 2, "the leading Sunday is free");
  const sunday = result.days.find((d) => d.date === "2026-08-23");
  assert.equal(sunday.deductedDays, 0);
  assert.match(sunday.reason, /not surrounded/);
});

test("sandwich: leave ending on a Friday does not pull in the weekend", () => {
  const result = computeDays({
    fromDate: "2026-08-19",
    toDate: "2026-08-21",
    rule: fixtures.leaveRule({ counting: { weeklyOffs: "sandwich" } }),
  });

  assert.equal(result.leaveDays, 3, "Wed, Thu, Fri — the weekend is outside the range");
});

test("holidays follow their own counting rule, separate from weekends", () => {
  const holidays = { "2026-08-20": "Onam" };

  const excluded = computeDays({
    fromDate: "2026-08-19",
    toDate: "2026-08-21",
    holidays,
    rule: fixtures.leaveRule({ counting: { holidays: "exclude", weeklyOffs: "include" } }),
  });
  assert.equal(excluded.leaveDays, 2, "the holiday is free");

  const included = computeDays({
    fromDate: "2026-08-19",
    toDate: "2026-08-21",
    holidays,
    rule: fixtures.leaveRule({ counting: { holidays: "include", weeklyOffs: "exclude" } }),
  });
  assert.equal(included.leaveDays, 3, "the holiday is deducted");
});

test("the breakdown explains where the days went", () => {
  const result = computeDays({
    fromDate: "2026-08-21",
    toDate: "2026-08-24",
    rule: fixtures.leaveRule({ counting: { weeklyOffs: "exclude" } }),
  });

  const total = result.breakdown.find((b) => b.rule === "total");
  assert.equal(total.effect, "3");
  assert.ok(result.breakdown.some((b) => b.rule === "days_off_excluded"));
});

// ── Allocation ──────────────────────────────────────────────────────────────

test("a full-year employee gets the whole allocation", () => {
  const result = engine.computeAllocation({
    rule: fixtures.leaveRule({ allocation: { mode: "annual", daysPerPeriod: 12 } }),
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    joiningDate: "2020-06-01",
  });

  assert.equal(result.days, 12);
});

test("a mid-year joiner is prorated and rounded to the nearest half", () => {
  const result = engine.computeAllocation({
    rule: fixtures.leaveRule({
      allocation: { mode: "annual", daysPerPeriod: 12, prorateOnJoining: true, rounding: "nearest_half" },
    }),
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    joiningDate: "2026-07-01",
  });

  // 184 of 365 days ≈ 50.4% of 12 = 6.05, rounded to 6.
  assert.equal(result.days, 6);
  assert.ok(result.breakdown.some((b) => b.rule === "prorate_joining"));
});

test("a joining date given as a Date is prorated, not turned into NaN", () => {
  // Mongo hands back a Date, not a string. Left unnormalised this produced a
  // NaN allocation, which then failed schema validation on save rather than
  // showing up as a wrong number.
  const result = engine.computeAllocation({
    rule: fixtures.leaveRule({
      allocation: { mode: "annual", daysPerPeriod: 12, prorateOnJoining: true, rounding: "nearest_half" },
    }),
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    joiningDate: new Date("2026-07-01T00:00:00.000Z"),
  });

  assert.ok(Number.isFinite(result.days), "allocation must be a real number");
  assert.equal(result.days, 6);
});

test("an exit date given as a Date prorates the same way", () => {
  const result = engine.computeAllocation({
    rule: fixtures.leaveRule({
      allocation: { mode: "annual", daysPerPeriod: 12, prorateOnExit: true, rounding: "nearest_half" },
    }),
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    joiningDate: "2020-01-01",
    exitDate: new Date("2026-06-30T00:00:00.000Z"),
  });

  assert.ok(Number.isFinite(result.days));
  assert.ok(result.days > 5 && result.days < 7, `expected about half of 12, got ${result.days}`);
});

test("asDateString normalises every shape a caller might pass", () => {
  assert.equal(engine.asDateString(new Date("2026-08-20T10:30:00.000Z")), "2026-08-20");
  assert.equal(engine.asDateString("2026-08-20"), "2026-08-20");
  assert.equal(engine.asDateString("2026-08-20T00:00:00.000Z"), "2026-08-20");
  assert.equal(engine.asDateString(null), null);
  assert.equal(engine.asDateString("not a date"), null);
  assert.equal(engine.asDateString(new Date("nonsense")), null);
});

test("proration can be switched off", () => {
  const result = engine.computeAllocation({
    rule: fixtures.leaveRule({ allocation: { daysPerPeriod: 12, prorateOnJoining: false } }),
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    joiningDate: "2026-11-01",
  });

  assert.equal(result.days, 12);
});

test("monthly and accrual modes annualise correctly", () => {
  const monthly = engine.computeAllocation({
    rule: fixtures.leaveRule({ allocation: { mode: "monthly", daysPerPeriod: 1, prorateOnJoining: false } }),
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
  });
  assert.equal(monthly.days, 12);

  const accrual = engine.computeAllocation({
    rule: fixtures.leaveRule({
      allocation: { mode: "accrual", accrualPerMonth: 1.25, prorateOnJoining: false, rounding: "none" },
    }),
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
  });
  assert.equal(accrual.days, 15);
});

test("allocation respects the maximum balance cap", () => {
  const result = engine.computeAllocation({
    rule: fixtures.leaveRule({
      allocation: { mode: "annual", daysPerPeriod: 30, maximumBalance: 20, prorateOnJoining: false },
    }),
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
  });

  assert.equal(result.days, 20);
  assert.ok(result.breakdown.some((b) => b.rule === "maximum_balance"));
});

// ── Carry forward ───────────────────────────────────────────────────────────

test("carry forward is capped, and the rest lapses", () => {
  const result = engine.computeCarryForward({
    rule: fixtures.leaveRule({ carryForward: { enabled: true, maximumDays: 10 } }),
    closingBalance: 17,
  });

  assert.equal(result.carried, 10);
  assert.equal(result.lapsed, 7);
});

test("without carry forward the whole balance lapses", () => {
  const result = engine.computeCarryForward({
    rule: fixtures.leaveRule({ carryForward: { enabled: false } }),
    closingBalance: 8,
  });

  assert.equal(result.carried, 0);
  assert.equal(result.lapsed, 8);
});

test("a negative closing balance never carries a negative forward", () => {
  const result = engine.computeCarryForward({
    rule: fixtures.leaveRule({ carryForward: { enabled: true, maximumDays: 10 } }),
    closingBalance: -3,
  });

  assert.equal(result.carried, 0);
  assert.equal(result.lapsed, 0);
});

// ── Application rules ───────────────────────────────────────────────────────

test("a request larger than the balance is rejected by default", () => {
  const problems = engine.checkApplicationRules({
    rule: fixtures.leaveRule(),
    leaveDays: 5,
    fromDate: "2026-09-01",
    today: "2026-08-20",
    balanceAvailable: 3,
    requestsThisYear: 0,
  });

  assert.equal(problems.length, 1);
  assert.match(problems[0], /3 day\(s\) available/);
});

test("a negative balance is allowed when the policy says so, up to a limit", () => {
  const rule = fixtures.leaveRule({
    application: { allowNegativeBalance: true, maximumNegativeDays: 5 },
  });

  const withinLimit = engine.checkApplicationRules({
    rule,
    leaveDays: 5,
    fromDate: "2026-09-01",
    today: "2026-08-20",
    balanceAvailable: 2,
    requestsThisYear: 0,
  });
  assert.deepEqual(withinLimit, [], "3 days negative is within the 5 day limit");

  const beyondLimit = engine.checkApplicationRules({
    rule,
    leaveDays: 12,
    fromDate: "2026-09-01",
    today: "2026-08-20",
    balanceAvailable: 2,
    requestsThisYear: 0,
  });
  assert.equal(beyondLimit.length, 1);
  assert.match(beyondLimit[0], /10 days negative/);
});

test("the notice period is enforced", () => {
  const problems = engine.checkApplicationRules({
    rule: fixtures.leaveRule({ application: { noticeDays: 7 } }),
    leaveDays: 2,
    fromDate: "2026-08-22",
    today: "2026-08-20",
    balanceAvailable: 10,
    requestsThisYear: 0,
  });

  assert.equal(problems.length, 1);
  assert.match(problems[0], /needs 7 day\(s\) of notice/);
});

test("backdated applications can be blocked or bounded", () => {
  const blocked = engine.checkApplicationRules({
    rule: fixtures.leaveRule({ application: { allowBackdated: false } }),
    leaveDays: 1,
    fromDate: "2026-08-10",
    today: "2026-08-20",
    balanceAvailable: 10,
    requestsThisYear: 0,
  });
  assert.match(blocked[0], /not allowed/);

  const tooOld = engine.checkApplicationRules({
    rule: fixtures.leaveRule({ application: { allowBackdated: true, backdatedLimitDays: 5 } }),
    leaveDays: 1,
    fromDate: "2026-08-10",
    today: "2026-08-20",
    balanceAvailable: 10,
    requestsThisYear: 0,
  });
  assert.match(tooOld[0], /limited to 5 days/);
});

test("per-request minimum and maximum are enforced", () => {
  const tooLong = engine.checkApplicationRules({
    rule: fixtures.leaveRule({ application: { maximumDaysPerRequest: 3 } }),
    leaveDays: 5,
    fromDate: "2026-09-01",
    today: "2026-08-20",
    balanceAvailable: 20,
    requestsThisYear: 0,
  });
  assert.match(tooLong[0], /maximum per request is 3/);
});

test("the yearly request cap is enforced", () => {
  const problems = engine.checkApplicationRules({
    rule: fixtures.leaveRule({ application: { maximumRequestsPerYear: 4 } }),
    leaveDays: 1,
    fromDate: "2026-09-01",
    today: "2026-08-20",
    balanceAvailable: 10,
    requestsThisYear: 4,
  });

  assert.match(problems[0], /all 4 requests/);
});

// ── Eligibility ─────────────────────────────────────────────────────────────

test("a gender-restricted leave type is not offered to everyone", () => {
  const leaveType = {
    name: "Maternity Leave",
    eligibility: { genders: ["female"], minimumServiceMonths: 0 },
  };

  const notEligible = engine.checkEligibility({
    employee: { personal: { gender: "male" }, employment: {} },
    leaveType,
    asOfDate: "2026-08-20",
  });
  assert.equal(notEligible.eligible, false);

  const eligible = engine.checkEligibility({
    employee: { personal: { gender: "female" }, employment: {} },
    leaveType,
    asOfDate: "2026-08-20",
  });
  assert.equal(eligible.eligible, true);
});

test("a minimum service requirement is respected and explained", () => {
  const result = engine.checkEligibility({
    employee: {
      personal: { gender: "female" },
      employment: { joiningDate: "2026-06-01" },
    },
    leaveType: { name: "Earned Leave", eligibility: { minimumServiceMonths: 6 } },
    asOfDate: "2026-08-20",
  });

  assert.equal(result.eligible, false);
  assert.match(result.reasons[0], /after 6 months of service/);
});

test("probation and notice period restrictions apply", () => {
  const onProbation = engine.checkEligibility({
    employee: { personal: {}, employment: {} },
    leaveType: { name: "Earned Leave", eligibility: { availableDuringProbation: false } },
    asOfDate: "2026-08-20",
    isProbation: true,
  });
  assert.match(onProbation.reasons[0], /during probation/);

  const onNotice = engine.checkEligibility({
    employee: { personal: {}, employment: {} },
    leaveType: { name: "Earned Leave", eligibility: { availableDuringNotice: false } },
    asOfDate: "2026-08-20",
    isNoticePeriod: true,
  });
  assert.match(onNotice.reasons[0], /during the notice period/);
});

// ── Determinism ─────────────────────────────────────────────────────────────

test("the same request always costs the same", () => {
  const inputs = {
    fromDate: "2026-08-19",
    toDate: "2026-08-26",
    rule: fixtures.leaveRule({ counting: { weeklyOffs: "sandwich", holidays: "sandwich" } }),
    holidays: { "2026-08-20": "Onam" },
  };

  const first = computeDays(inputs).leaveDays;
  for (let i = 0; i < 20; i += 1) {
    assert.equal(computeDays(inputs).leaveDays, first);
  }
});
