"use strict";

/**
 * The configuration a new organization starts with.
 *
 * Every company needs a shift, an attendance policy, leave types and salary
 * components before the platform does anything useful — and asking an HR
 * administrator to invent all of that from an empty screen, correctly, on day
 * one is the single biggest reason a setup stalls. So a new tenant is created
 * with a working, conventional Indian-SMB configuration already in place.
 *
 * Two rules govern what is in here:
 *
 *   1. Everything is ordinary and safe to change. These are starting points,
 *      not opinions — an admin can edit or delete any of it, and nothing in
 *      the platform depends on a particular row existing.
 *
 *   2. Nothing here is legal advice. The statutory figures (PF at 12% capped
 *      at ₹1,800, ESI below ₹21,000, professional tax) are the common Indian
 *      defaults at the time of writing, and are exactly the numbers an admin
 *      should confirm against current rules for their state and year.
 */

const DEFAULT_SHIFTS = [
  {
    name: "General",
    code: "GEN",
    type: "fixed",
    startTime: "09:00",
    endTime: "18:00",
    breakMinutes: 60,
    isBreakPaid: false,
    colour: "#4F46E5",
    isDefault: true,
  },
];

const DEFAULT_ATTENDANCE_POLICY = {
  name: "Standard policy",
  code: "STANDARD",
  isDefault: true,
  arrival: {
    graceMinutes: 15,
    lateAfterMinutes: 0,
    halfDayAfterMinutes: 240,
    absentAfterMinutes: 0,
    earlyArrivalCountsAsOvertime: false,
  },
  departure: { graceMinutes: 15, earlyLeavingAfterMinutes: 30, halfDayBeforeMinutes: 240 },
  hours: {
    basis: "shift_based",
    fullDayPercent: 90,
    halfDayPercent: 45,
    fullDayMinutes: 480,
    halfDayMinutes: 240,
    minimumMinutesForPresence: 60,
  },
  // `first_last` — only the first and last punch of the day matter, and the
  // shift's nominal break is deducted. Simpler for staff than `paired`, which
  // requires punching reliably at every break.
  breaks: { calculation: "first_last", maxBreakMinutes: 60, deductExcessBreak: true },
  // Off by default: an automatic pay deduction nobody was told about is the
  // fastest way to lose a new customer's trust in the numbers.
  lateMarks: { enabled: false, countForDeduction: 3, deductionType: "half_day", resetPeriod: "monthly" },
  overtime: {
    enabled: true,
    startsAfterMinutes: 30,
    minimumMinutes: 30,
    maximumMinutesPerDay: 240,
    roundToMinutes: 15,
    requiresApproval: true,
    normalDayRate: 1.5,
    weeklyOffRate: 2,
    holidayRate: 2,
  },
  missingPunch: { treatAs: "pending", notifyEmployee: true },
  regularization: { enabled: true, windowDays: 7, maxPerMonth: 3, requiresApproval: true },
};

const DEFAULT_LEAVE_TYPES = [
  { name: "Casual Leave", code: "CL", colour: "#0EA5E9", isPaid: true, description: "Short, unplanned personal leave." },
  { name: "Sick Leave", code: "SL", colour: "#F59E0B", isPaid: true, description: "Illness and medical appointments." },
  { name: "Earned Leave", code: "EL", colour: "#10B981", isPaid: true, description: "Annual leave that accrues over the year." },
  { name: "Loss of Pay", code: "LOP", colour: "#6B7280", isPaid: false, description: "Unpaid leave, deducted from salary." },
];

/**
 * Salary components, in calculation order.
 *
 * The order is the whole point: Basic is a share of CTC, HRA is a share of
 * Basic, and Special Allowance absorbs whatever is left so the components
 * always add up to exactly the CTC. Each one can only reference the ones
 * before it, which is why the order numbers are spaced out — there is room to
 * insert something later without renumbering everything.
 */
const DEFAULT_SALARY_COMPONENTS = [
  {
    name: "Basic",
    code: "BASIC",
    type: "earning",
    category: "basic",
    order: 10,
    description: "The foundation of the salary. Most other components are a share of this.",
    calculation: { method: "formula", expression: "pct(CTC_MONTHLY, 40)", rounding: "nearest_1" },
    prorateOnAttendance: true,
    showOnPayslip: true,
    includeInGross: true,
  },
  {
    name: "House Rent Allowance",
    code: "HRA",
    type: "earning",
    category: "allowance",
    order: 20,
    description: "Typically 50% of Basic in metro cities, 40% elsewhere.",
    calculation: { method: "formula", expression: "pct(BASIC, 50)", rounding: "nearest_1" },
    prorateOnAttendance: true,
    showOnPayslip: true,
    includeInGross: true,
  },
  {
    name: "Conveyance Allowance",
    code: "CONVEYANCE",
    type: "earning",
    category: "allowance",
    order: 30,
    description: "A fixed travel allowance.",
    calculation: { method: "fixed", amount: 1600, rounding: "nearest_1" },
    prorateOnAttendance: true,
    showOnPayslip: true,
    includeInGross: true,
  },
  {
    name: "Special Allowance",
    code: "SPECIAL",
    type: "earning",
    category: "allowance",
    order: 90,
    description: "The balancing figure — whatever is left after the other earnings, so the total matches CTC exactly.",
    calculation: {
      method: "formula",
      expression: "max(CTC_MONTHLY - BASIC - HRA - CONVEYANCE, 0)",
      rounding: "nearest_1",
    },
    prorateOnAttendance: true,
    showOnPayslip: true,
    includeInGross: true,
  },
  {
    name: "Provident Fund",
    code: "PF",
    type: "deduction",
    category: "statutory",
    order: 100,
    description: "Employee's PF contribution: 12% of Basic, capped at ₹1,800 a month. Confirm against current rules.",
    calculation: { method: "formula", expression: "min(pct(BASIC, 12), 1800)", rounding: "nearest_1" },
    prorateOnAttendance: false,
    showOnPayslip: true,
    includeInGross: false,
  },
  {
    name: "Professional Tax",
    code: "PT",
    type: "deduction",
    category: "statutory",
    order: 110,
    description: "A state tax. The amount varies by state — confirm the figure for yours.",
    calculation: { method: "fixed", amount: 200, rounding: "nearest_1" },
    prorateOnAttendance: false,
    showOnPayslip: true,
    includeInGross: false,
  },
  {
    name: "Provident Fund (Employer)",
    code: "PF_EMPLOYER",
    type: "employer_contribution",
    category: "statutory",
    order: 120,
    description: "The company's matching PF contribution. Does not reduce the employee's take-home pay.",
    calculation: { method: "formula", expression: "min(pct(BASIC, 12), 1800)", rounding: "nearest_1" },
    prorateOnAttendance: false,
    showOnPayslip: true,
    includeInGross: false,
  },
];

module.exports = {
  DEFAULT_SHIFTS,
  DEFAULT_ATTENDANCE_POLICY,
  DEFAULT_LEAVE_TYPES,
  DEFAULT_SALARY_COMPONENTS,
};
