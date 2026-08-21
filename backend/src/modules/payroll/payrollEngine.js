"use strict";

const formula = require("../../core/rules/formula");
const { AppError } = require("../../core/errors/AppError");

/**
 * The payroll calculation engine.
 *
 * Pure, deterministic, and fully explainable. Given a salary, a structure, and
 * an attendance summary, it produces the payslip lines and an ordered
 * breakdown of how each figure was reached.
 *
 * Every component's value comes from configuration — a fixed amount, a
 * percentage of another component, or a formula run through the safe
 * expression engine. There is no arithmetic in this file that a customer
 * cannot change from the settings screen.
 *
 * Components are evaluated in `order`, and each one's result becomes a
 * variable available to the next. That is what allows the ordinary Indian
 * chain to be expressed entirely as data:
 *
 *   BASIC = pct(CTC_MONTHLY, 40)
 *   HRA   = pct(BASIC, 50)
 *   PF    = min(pct(BASIC, 12), 1800)
 */

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * @param {Object} input
 * @param {Object} input.employee          lean Employee document
 * @param {Object} input.salary            EmployeeSalary in force for the period
 * @param {Array}  input.components        resolved components, in order
 * @param {Object} input.attendance        summary for the period
 * @param {Object} input.settings          payroll settings for the organization
 * @param {Array}  [input.adjustments]     one-off additions/deductions
 * @returns {Object} lines, totals and breakdown
 */
function calculate({ employee, salary, components, attendance, settings, adjustments = [] }) {
  const breakdown = [];
  const note = (rule, detail, effect) => breakdown.push({ rule, detail, effect });

  // ── 1. Per-day basis ──────────────────────────────────────────────────────
  const basis = settings["payroll.working_days_basis"] || "calendar_days";
  let daysInPeriod;

  if (basis === "fixed_days") {
    daysInPeriod = settings["payroll.fixed_days_in_month"] || 30;
    note("day_basis", `Fixed ${daysInPeriod} days per month`, `${daysInPeriod} days`);
  } else if (basis === "working_days") {
    daysInPeriod = attendance.workingDays || attendance.totalDays;
    note("day_basis", `Working days in the period`, `${daysInPeriod} days`);
  } else {
    daysInPeriod = attendance.totalDays;
    note("day_basis", `Calendar days in the period`, `${daysInPeriod} days`);
  }

  if (!daysInPeriod || daysInPeriod <= 0) {
    throw new AppError("FORMULA_ERROR", {
      message: "The pay period has no days to divide by. Check the payroll configuration.",
    });
  }

  const payableDays = Math.min(attendance.payableDays, daysInPeriod);
  const lossOfPayDays = round2(Math.max(0, daysInPeriod - payableDays));
  const prorationFactor = payableDays / daysInPeriod;

  note(
    "attendance",
    `${attendance.presentDays} present, ${attendance.paidLeaveDays} paid leave, ` +
      `${attendance.absentDays} absent, ${attendance.unpaidLeaveDays} unpaid leave`,
    `${payableDays} payable of ${daysInPeriod}`
  );

  if (lossOfPayDays > 0 && settings["payroll.lop_from_attendance"] !== false) {
    note(
      "loss_of_pay",
      `${lossOfPayDays} day(s) not payable`,
      `× ${Math.round(prorationFactor * 10000) / 100}% on prorated components`
    );
  }

  // ── 2. Variables available to formulas ────────────────────────────────────
  const ctcMonthly = salary.ctcMonthly || round2((salary.ctcAnnual || 0) / 12);

  const variables = {
    CTC: salary.ctcAnnual || 0,
    CTC_MONTHLY: ctcMonthly,
    CTC_ANNUAL: salary.ctcAnnual || 0,

    DAYS_IN_PERIOD: daysInPeriod,
    WORKING_DAYS: attendance.workingDays || 0,
    PAYABLE_DAYS: payableDays,
    PRESENT_DAYS: attendance.presentDays || 0,
    ABSENT_DAYS: attendance.absentDays || 0,
    LOP_DAYS: lossOfPayDays,
    PAID_LEAVE_DAYS: attendance.paidLeaveDays || 0,
    UNPAID_LEAVE_DAYS: attendance.unpaidLeaveDays || 0,
    OVERTIME_HOURS: attendance.overtimeHours || 0,
    PRORATION_FACTOR: round2(prorationFactor),

    GROSS: 0, // filled in as components are evaluated
    TOTAL_EARNINGS: 0,
    TOTAL_DEDUCTIONS: 0,
  };

  // Manually-set component amounts from the employee's salary record.
  const manualAmounts =
    salary.componentAmounts instanceof Map
      ? Object.fromEntries(salary.componentAmounts)
      : salary.componentAmounts || {};

  // ── 3. Evaluate each component in order ───────────────────────────────────
  const lines = [];
  const errors = [];

  for (const component of components) {
    const calc = component.calculation || {};
    let fullAmount = 0;
    let explanation = "";
    let expression = "";

    try {
      switch (calc.method) {
        case "fixed":
          fullAmount = manualAmounts[component.code] !== undefined
            ? Number(manualAmounts[component.code])
            : calc.amount || 0;
          explanation = `Fixed amount`;
          break;

        case "percentage": {
          const base = variables[calc.ofComponent];
          if (base === undefined) {
            throw new AppError("FORMULA_ERROR", {
              message: `${component.name} is a percentage of ${calc.ofComponent}, which has not been calculated yet. Check the component order.`,
            });
          }
          fullAmount = (base * (calc.percentage || 0)) / 100;
          expression = `${calc.percentage}% of ${calc.ofComponent}`;
          explanation = `${calc.percentage}% of ${formatNumber(base)}`;
          break;
        }

        case "formula": {
          if (!calc.expression) {
            fullAmount = 0;
            explanation = "No formula configured";
            break;
          }
          const result = formula.evaluateAmount(calc.expression, variables, { strict: true });
          fullAmount = result.value;
          expression = calc.expression;
          explanation = `${calc.expression} (using ${result.used.join(", ") || "no variables"})`;
          break;
        }

        case "attendance_based": {
          // A per-day rate driven straight by payable days.
          const rate = manualAmounts[component.code] !== undefined
            ? Number(manualAmounts[component.code])
            : calc.amount || 0;
          fullAmount = rate * daysInPeriod;
          expression = `${formatNumber(rate)} per day`;
          explanation = `${formatNumber(rate)} × ${daysInPeriod} days`;
          break;
        }

        case "manual":
        default:
          fullAmount = manualAmounts[component.code] !== undefined
            ? Number(manualAmounts[component.code])
            : 0;
          explanation = "Set on the employee's salary record";
          break;
      }
    } catch (err) {
      errors.push({ component: component.code, message: err.message });
      note("component_error", `${component.name}: ${err.message}`, "skipped");
      continue;
    }

    // Bounds
    if (calc.minAmount !== null && calc.minAmount !== undefined && fullAmount < calc.minAmount) {
      explanation += ` (raised to the minimum of ${formatNumber(calc.minAmount)})`;
      fullAmount = calc.minAmount;
    }
    if (calc.maxAmount !== null && calc.maxAmount !== undefined && fullAmount > calc.maxAmount) {
      explanation += ` (capped at ${formatNumber(calc.maxAmount)})`;
      fullAmount = calc.maxAmount;
    }

    fullAmount = applyRounding(fullAmount, calc.rounding);

    // Attendance proration
    const shouldProrate =
      component.prorateOnAttendance &&
      lossOfPayDays > 0 &&
      settings["payroll.lop_from_attendance"] !== false &&
      calc.method !== "attendance_based";

    const amount = shouldProrate
      ? applyRounding(fullAmount * prorationFactor, calc.rounding)
      : calc.method === "attendance_based"
        ? applyRounding((manualAmountOrZero(manualAmounts, component, calc)) * payableDays, calc.rounding)
        : fullAmount;

    lines.push({
      componentId: component._id,
      code: component.code,
      name: component.name,
      type: component.type,
      category: component.category,
      fullAmount: round2(fullAmount),
      amount: round2(amount),
      prorated: shouldProrate || calc.method === "attendance_based",
      formula: expression,
      explanation:
        explanation +
        (shouldProrate
          ? ` — prorated for ${payableDays} of ${daysInPeriod} days`
          : ""),
      showOnPayslip: component.showOnPayslip !== false,
      order: component.order,
    });

    // The calculated value becomes a variable for later components.
    variables[component.code] = round2(amount);

    if (component.type === "earning" && component.includeInGross) {
      variables.GROSS = round2(variables.GROSS + amount);
      variables.TOTAL_EARNINGS = variables.GROSS;
    }
    if (component.type === "deduction") {
      variables.TOTAL_DEDUCTIONS = round2(variables.TOTAL_DEDUCTIONS + amount);
    }
  }

  // ── 4. One-off adjustments ────────────────────────────────────────────────
  let adjustmentEarnings = 0;
  let adjustmentDeductions = 0;

  for (const adjustment of adjustments) {
    if (adjustment.type === "earning") {
      adjustmentEarnings += adjustment.amount;
      note("adjustment", `${adjustment.label}: ${adjustment.reason || "manual addition"}`, `+${formatNumber(adjustment.amount)}`);
    } else {
      adjustmentDeductions += adjustment.amount;
      note("adjustment", `${adjustment.label}: ${adjustment.reason || "manual deduction"}`, `−${formatNumber(adjustment.amount)}`);
    }
  }

  // ── 5. Totals ─────────────────────────────────────────────────────────────
  const gross = round2(
    lines
      .filter((l) => l.type === "earning")
      .reduce((sum, l) => sum + l.amount, 0) + adjustmentEarnings
  );

  const totalDeductions = round2(
    lines
      .filter((l) => l.type === "deduction")
      .reduce((sum, l) => sum + l.amount, 0) + adjustmentDeductions
  );

  const employerContributions = round2(
    lines.filter((l) => l.type === "employer_contribution").reduce((sum, l) => sum + l.amount, 0)
  );

  const reimbursements = round2(
    lines.filter((l) => l.type === "reimbursement").reduce((sum, l) => sum + l.amount, 0)
  );

  let net = round2(gross - totalDeductions + reimbursements);
  const rounding = settings["payroll.rounding"] || "nearest_1";
  const netBeforeRounding = net;
  net = applyNetRounding(net, rounding);
  if (net !== netBeforeRounding) {
    note("net_rounding", `${formatNumber(netBeforeRounding)} rounded (${rounding})`, formatNumber(net));
  }

  note("gross", "Total earnings", formatNumber(gross));
  note("deductions", "Total deductions", formatNumber(totalDeductions));
  note("net", "Net payable", formatNumber(net));

  return {
    lines: lines.sort((a, b) => a.order - b.order),
    gross,
    totalDeductions,
    employerContributions,
    reimbursements,
    net,
    ctc: round2(gross + employerContributions),
    attendance: {
      ...attendance,
      totalDays: daysInPeriod,
      payableDays,
      lossOfPayDays,
    },
    variables,
    breakdown,
    errors,
  };
}

function manualAmountOrZero(manualAmounts, component, calc) {
  return manualAmounts[component.code] !== undefined
    ? Number(manualAmounts[component.code])
    : calc.amount || 0;
}

function applyRounding(value, mode) {
  switch (mode) {
    case "nearest_10":
      return Math.round(value / 10) * 10;
    case "nearest_1":
      return Math.round(value);
    case "none":
    default:
      return round2(value);
  }
}

function applyNetRounding(value, mode) {
  switch (mode) {
    case "nearest_10":
      return Math.round(value / 10) * 10;
    case "nearest_1":
      return Math.round(value);
    case "none":
    default:
      return round2(value);
  }
}

function formatNumber(n) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(round2(n || 0));
}

/**
 * Resolve a component's effective calculation, applying any structure-level
 * override. Kept here so the service and the preview screen agree.
 */
function resolveComponent(component, structureEntry) {
  if (!structureEntry || !structureEntry.override) return component;

  const override = structureEntry.override;
  const calculation = { ...component.calculation };

  if (override.method) calculation.method = override.method;
  if (override.amount !== null && override.amount !== undefined) calculation.amount = override.amount;
  if (override.percentage !== null && override.percentage !== undefined) {
    calculation.percentage = override.percentage;
  }
  if (override.ofComponent) calculation.ofComponent = override.ofComponent;
  if (override.expression) calculation.expression = override.expression;

  return {
    ...component,
    calculation,
    order: structureEntry.order !== null && structureEntry.order !== undefined
      ? structureEntry.order
      : component.order,
  };
}

/**
 * Which variable names a formula author may use, for the editor's autocomplete
 * and for validation when a component is saved.
 */
function availableVariables(componentCodes = []) {
  return [
    "CTC",
    "CTC_MONTHLY",
    "CTC_ANNUAL",
    "DAYS_IN_PERIOD",
    "WORKING_DAYS",
    "PAYABLE_DAYS",
    "PRESENT_DAYS",
    "ABSENT_DAYS",
    "LOP_DAYS",
    "PAID_LEAVE_DAYS",
    "UNPAID_LEAVE_DAYS",
    "OVERTIME_HOURS",
    "PRORATION_FACTOR",
    "GROSS",
    "TOTAL_EARNINGS",
    "TOTAL_DEDUCTIONS",
    ...componentCodes,
  ];
}

module.exports = { calculate, resolveComponent, availableVariables, round2 };
