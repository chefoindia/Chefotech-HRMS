"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const engine = require("../../src/modules/payroll/payrollEngine");
const fixtures = require("../helpers/fixtures");

const SALARY = { ctcAnnual: 600000, ctcMonthly: 50000, componentAmounts: {} };

function fullAttendance(overrides = {}) {
  return {
    totalDays: 31,
    workingDays: 26,
    payableDays: 31,
    presentDays: 26,
    paidLeaveDays: 0,
    unpaidLeaveDays: 0,
    absentDays: 0,
    holidayDays: 1,
    weeklyOffDays: 4,
    overtimeHours: 0,
    ...overrides,
  };
}

function calculate(overrides = {}) {
  return engine.calculate({
    employee: { employeeCode: "EMP0001" },
    salary: SALARY,
    components: fixtures.salaryComponents(),
    attendance: fullAttendance(),
    settings: fixtures.payrollSettings(),
    adjustments: [],
    ...overrides,
  });
}

function lineFor(result, code) {
  return result.lines.find((l) => l.code === code);
}

// ── The component chain ─────────────────────────────────────────────────────

test("components resolve in order, each feeding the next", () => {
  const result = calculate();

  assert.equal(lineFor(result, "BASIC").amount, 20000, "40% of 50,000");
  assert.equal(lineFor(result, "HRA").amount, 10000, "50% of basic");
  assert.equal(lineFor(result, "SPECIAL").amount, 20000, "whatever is left of the monthly CTC");
  assert.equal(lineFor(result, "PF").amount, 1800, "12% of basic, capped at the statutory ceiling");
});

test("gross, deductions and net add up", () => {
  const result = calculate();

  assert.equal(result.gross, 50000);
  assert.equal(result.totalDeductions, 1800);
  assert.equal(result.net, 48200);
});

test("a formula error on one component does not abandon the payslip", () => {
  const components = fixtures.salaryComponents();
  components.push({
    _id: "c-broken",
    code: "BROKEN",
    name: "Broken Component",
    type: "earning",
    category: "other",
    order: 40,
    prorateOnAttendance: true,
    includeInGross: true,
    calculation: { method: "formula", expression: "NONSENSE_VARIABLE * 2" },
  });

  const result = calculate({ components });

  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].component, "BROKEN");
  assert.equal(result.gross, 50000, "the other components still calculated");
  assert.ok(result.breakdown.some((b) => b.rule === "component_error"));
});

// ── Loss of pay ─────────────────────────────────────────────────────────────

test("absence reduces prorated components proportionally", () => {
  // 28 of 31 days payable.
  const result = calculate({
    attendance: fullAttendance({ payableDays: 28, absentDays: 3, presentDays: 23 }),
  });

  const factor = 28 / 31;
  assert.equal(lineFor(result, "BASIC").fullAmount, 20000, "the full entitlement is recorded");
  assert.equal(lineFor(result, "BASIC").amount, Math.round(20000 * factor));
  assert.equal(lineFor(result, "BASIC").prorated, true);
  assert.equal(result.attendance.lossOfPayDays, 3);
});

test("the per-day basis is configuration and changes the deduction", () => {
  const attendance = fullAttendance({ payableDays: 25, absentDays: 1, presentDays: 25 });

  const calendarBasis = calculate({
    attendance,
    settings: fixtures.payrollSettings({ "payroll.working_days_basis": "calendar_days" }),
  });
  const fixedBasis = calculate({
    attendance,
    settings: fixtures.payrollSettings({
      "payroll.working_days_basis": "fixed_days",
      "payroll.fixed_days_in_month": 30,
    }),
  });
  const workingBasis = calculate({
    attendance,
    settings: fixtures.payrollSettings({ "payroll.working_days_basis": "working_days" }),
  });

  // Same attendance, three different answers — which is exactly why this is a
  // setting rather than a constant.
  assert.equal(calendarBasis.attendance.totalDays, 31);
  assert.equal(fixedBasis.attendance.totalDays, 30);
  assert.equal(workingBasis.attendance.totalDays, 26);
  assert.ok(workingBasis.net > calendarBasis.net, "a smaller divisor means a smaller deduction");
});

test("loss-of-pay deduction can be switched off entirely", () => {
  const attendance = fullAttendance({ payableDays: 20, absentDays: 11 });

  const withLop = calculate({ attendance });
  const withoutLop = calculate({
    attendance,
    settings: fixtures.payrollSettings({ "payroll.lop_from_attendance": false }),
  });

  assert.ok(withLop.net < withoutLop.net);
  assert.equal(withoutLop.gross, 50000, "nothing is prorated");
});

test("a component marked as not prorated keeps its full value", () => {
  const components = fixtures.salaryComponents().map((c) =>
    c.code === "SPECIAL" ? { ...c, prorateOnAttendance: false } : c
  );

  const result = calculate({
    components,
    attendance: fullAttendance({ payableDays: 20, absentDays: 11 }),
  });

  assert.equal(lineFor(result, "SPECIAL").amount, lineFor(result, "SPECIAL").fullAmount);
  assert.ok(lineFor(result, "BASIC").amount < lineFor(result, "BASIC").fullAmount);
});

test("paid leave does not reduce pay; unpaid leave does", () => {
  const paid = calculate({
    attendance: fullAttendance({ payableDays: 31, paidLeaveDays: 4, presentDays: 22 }),
  });
  const unpaid = calculate({
    attendance: fullAttendance({ payableDays: 27, unpaidLeaveDays: 4, presentDays: 22 }),
  });

  assert.equal(paid.net, 48200, "a fully payable month");
  assert.ok(unpaid.net < paid.net);
});

// ── Overtime ────────────────────────────────────────────────────────────────

test("overtime is paid from the hours attendance approved", () => {
  const components = fixtures.salaryComponents();
  components.push({
    _id: "c-ot",
    code: "OT",
    name: "Overtime",
    type: "earning",
    category: "overtime",
    order: 50,
    prorateOnAttendance: false,
    includeInGross: true,
    calculation: {
      method: "formula",
      expression: "round(BASIC / DAYS_IN_PERIOD / 8 * OVERTIME_HOURS * 1.5)",
    },
  });

  const result = calculate({
    components,
    attendance: fullAttendance({ overtimeHours: 10 }),
  });

  // Basic 20,000 over 31 days is 645.16/day, or 80.65/hour.
  // 80.65 × 10 hours × 1.5 = 1,209.68, rounded to 1,210.
  assert.equal(lineFor(result, "OT").amount, 1210);
  assert.equal(result.gross, 51210);
});

// ── Adjustments ─────────────────────────────────────────────────────────────

test("one-off adjustments move the totals and appear in the breakdown", () => {
  const result = calculate({
    adjustments: [
      { label: "Diwali bonus", type: "earning", amount: 5000, reason: "Festival" },
      { label: "Canteen recovery", type: "deduction", amount: 750, reason: "August" },
    ],
  });

  assert.equal(result.gross, 55000);
  assert.equal(result.totalDeductions, 2550);
  assert.equal(result.net, 52450);
  assert.equal(result.breakdown.filter((b) => b.rule === "adjustment").length, 2);
});

// ── Rounding ────────────────────────────────────────────────────────────────

test("net rounding follows the configured mode", () => {
  const salary = { ctcAnnual: 605000, ctcMonthly: 50417, componentAmounts: {} };

  const exact = calculate({ salary, settings: fixtures.payrollSettings({ "payroll.rounding": "none" }) });
  const nearestTen = calculate({
    salary,
    settings: fixtures.payrollSettings({ "payroll.rounding": "nearest_10" }),
  });

  assert.equal(nearestTen.net % 10, 0);
  assert.ok(Math.abs(nearestTen.net - exact.net) <= 5);
});

// ── Guards ──────────────────────────────────────────────────────────────────

test("a period with no days is refused rather than dividing by zero", () => {
  assert.throws(
    () =>
      calculate({
        attendance: fullAttendance({ totalDays: 0, workingDays: 0, payableDays: 0 }),
      }),
    /no days to divide by/
  );
});

test("a percentage of a component that has not been calculated yet is reported", () => {
  const components = [
    {
      _id: "c-hra",
      code: "HRA",
      name: "HRA",
      type: "earning",
      category: "allowance",
      order: 10,
      prorateOnAttendance: true,
      includeInGross: true,
      // Refers to BASIC, which is ordered after it.
      calculation: { method: "percentage", percentage: 50, ofComponent: "BASIC" },
    },
    {
      _id: "c-basic",
      code: "BASIC",
      name: "Basic",
      type: "earning",
      category: "basic",
      order: 20,
      prorateOnAttendance: true,
      includeInGross: true,
      calculation: { method: "formula", expression: "pct(CTC_MONTHLY, 40)" },
    },
  ];

  const result = calculate({ components });
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /has not been calculated yet/);
});

// ── Explainability and determinism ──────────────────────────────────────────

test("every line explains how it was calculated", () => {
  const result = calculate({
    attendance: fullAttendance({ payableDays: 28, absentDays: 3 }),
  });

  for (const line of result.lines) {
    assert.ok(line.explanation, `${line.code} has no explanation`);
  }
  assert.match(lineFor(result, "BASIC").explanation, /prorated for 28 of 31 days/);
  // Formula components quote the expression and the variables it consumed, so
  // the line can be traced back to the configuration that produced it.
  assert.match(lineFor(result, "HRA").explanation, /pct\(BASIC, 50\).*using BASIC/);

  // A percentage component explains itself in words instead.
  const percentageResult = calculate({
    components: [
      fixtures.salaryComponents()[0],
      {
        _id: "c-pct",
        code: "BONUS",
        name: "Bonus",
        type: "earning",
        category: "bonus",
        order: 25,
        prorateOnAttendance: false,
        includeInGross: true,
        calculation: { method: "percentage", percentage: 20, ofComponent: "BASIC" },
      },
    ],
  });
  assert.match(lineFor(percentageResult, "BONUS").explanation, /20% of 20,000/);
});

test("the breakdown accounts for the whole payslip", () => {
  const result = calculate({ attendance: fullAttendance({ payableDays: 28, absentDays: 3 }) });

  const rules = result.breakdown.map((b) => b.rule);
  for (const expected of ["day_basis", "attendance", "loss_of_pay", "gross", "deductions", "net"]) {
    assert.ok(rules.includes(expected), `the breakdown is missing "${expected}"`);
  }
});

test("payroll is deterministic across repeated runs", () => {
  const inputs = {
    attendance: fullAttendance({ payableDays: 27.5, absentDays: 2, unpaidLeaveDays: 1.5, overtimeHours: 6 }),
  };

  const first = calculate(inputs);
  for (let i = 0; i < 30; i += 1) {
    const again = calculate(inputs);
    assert.equal(again.gross, first.gross);
    assert.equal(again.totalDeductions, first.totalDeductions);
    assert.equal(again.net, first.net);
    assert.deepEqual(
      again.lines.map((l) => l.amount),
      first.lines.map((l) => l.amount)
    );
  }
});

test("structure overrides replace a component's own calculation", () => {
  const [basic] = fixtures.salaryComponents();
  const overridden = engine.resolveComponent(basic, {
    override: { method: "percentage", percentage: 60, ofComponent: "CTC_MONTHLY" },
    order: 5,
  });

  assert.equal(overridden.calculation.method, "percentage");
  assert.equal(overridden.calculation.percentage, 60);
  assert.equal(overridden.order, 5);
  assert.equal(basic.calculation.method, "formula", "the original component is untouched");
});
