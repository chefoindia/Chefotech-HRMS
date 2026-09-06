"use strict";

const mongoose = require("mongoose");
const { createTenantSchema, tenantUnique } = require("../../core/tenancy/baseSchema");

/**
 * A salary component: one line on a payslip.
 *
 * The amount is either a fixed number, a percentage of another component, or a
 * formula evaluated by the safe expression engine. Nothing about "Basic is 40%
 * of CTC" or "HRA is 50% of Basic" is hard-coded — those are two rows in this
 * collection with two different formulas.
 */
const salaryComponentSchema = createTenantSchema({
  name: { type: String, required: true, trim: true },
  code: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    // The code is the variable name a formula refers to, so it has to be a
    // valid identifier for the expression parser.
    match: [/^[A-Z][A-Z0-9_]{0,29}$/, "Use uppercase letters, numbers and underscores"],
  },
  description: { type: String, default: "" },

  type: {
    type: String,
    enum: ["earning", "deduction", "employer_contribution", "reimbursement", "informational"],
    required: true,
    index: true,
  },

  category: {
    type: String,
    enum: [
      "basic", "allowance", "bonus", "overtime", "arrear", "incentive",
      "statutory", "tax", "loan", "advance", "attendance", "other",
    ],
    default: "other",
  },

  calculation: {
    method: {
      type: String,
      enum: ["fixed", "percentage", "formula", "attendance_based", "manual"],
      default: "fixed",
    },
    /** For "fixed". */
    amount: { type: Number, default: 0 },
    /** For "percentage": percent OF the component named in `ofComponent`. */
    percentage: { type: Number, default: 0 },
    ofComponent: { type: String, default: "CTC" },
    /** For "formula". Evaluated against other components and payroll inputs. */
    expression: { type: String, default: "" },

    minAmount: { type: Number, default: null },
    maxAmount: { type: Number, default: null },
    rounding: { type: String, enum: ["none", "nearest_1", "nearest_10"], default: "nearest_1" },
  },

  /**
   * Is this component reduced when the employee was absent?
   * Salary components usually are; a fixed reimbursement usually is not.
   */
  prorateOnAttendance: { type: Boolean, default: true },
  /** Included in the gross figure shown on the payslip. */
  includeInGross: { type: Boolean, default: true },
  /** Part of the CTC quoted to the employee. */
  includeInCtc: { type: Boolean, default: true },
  taxable: { type: Boolean, default: true },

  /** Calculation order. Components can only reference earlier ones. */
  order: { type: Number, default: 100 },

  showOnPayslip: { type: Boolean, default: true },
  isStatutory: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true, index: true },
});

tenantUnique(salaryComponentSchema, "code");
salaryComponentSchema.index({ organizationId: 1, type: 1, order: 1 });

const SalaryComponent = mongoose.model("SalaryComponent", salaryComponentSchema);

/** A named set of components — "Staff structure", "Worker structure". */
const salaryStructureSchema = createTenantSchema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true, uppercase: true },
  description: { type: String, default: "" },

  components: {
    type: [
      {
        componentId: { type: mongoose.Schema.Types.ObjectId, ref: "SalaryComponent", required: true },
        /** Per-structure override of the component's own calculation. */
        override: {
          method: { type: String, enum: ["fixed", "percentage", "formula", "attendance_based", "manual", null], default: null },
          amount: { type: Number, default: null },
          percentage: { type: Number, default: null },
          ofComponent: { type: String, default: null },
          expression: { type: String, default: null },
        },
        order: { type: Number, default: null },
      },
    ],
    default: [],
  },

  isDefault: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  employeeCount: { type: Number, default: 0 },
});

tenantUnique(salaryStructureSchema, "code");

salaryStructureSchema.pre("save", async function enforceSingleDefault(next) {
  if (this.isDefault && this.isModified("isDefault")) {
    await this.constructor.updateMany(
      { _id: { $ne: this._id }, isDefault: true },
      { $set: { isDefault: false } }
    );
  }
  next();
});

const SalaryStructure = mongoose.model("SalaryStructure", salaryStructureSchema);

/**
 * One employee's compensation, effective from a date.
 *
 * Revisions are new rows, never edits: last March's payslip has to remain
 * reproducible after a raise in April, and a salary history is something both
 * auditors and employees ask for.
 */
const employeeSalarySchema = createTenantSchema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
  structureId: { type: mongoose.Schema.Types.ObjectId, ref: "SalaryStructure", required: true },

  effectiveFrom: { type: String, required: true, index: true },
  effectiveTo: { type: String, default: null },

  /** The headline figure the formulas derive from. */
  ctcAnnual: { type: Number, default: 0 },
  ctcMonthly: { type: Number, default: 0 },

  /** Fixed amounts for components whose method is "manual" or overridden. */
  componentAmounts: { type: Map, of: Number, default: {} },

  paymentMode: {
    type: String,
    enum: ["bank_transfer", "cheque", "cash", "upi"],
    default: "bank_transfer",
  },

  revisionReason: { type: String, default: "" },
  revisionType: {
    type: String,
    enum: ["initial", "increment", "promotion", "correction", "restructure"],
    default: "initial",
  },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  approvedAt: { type: Date, default: null },

  isActive: { type: Boolean, default: true, index: true },
});

employeeSalarySchema.index({ organizationId: 1, employeeId: 1, effectiveFrom: -1 });

const EmployeeSalary = mongoose.model("EmployeeSalary", employeeSalarySchema);

/** A pay period: normally a calendar month, but the cycle is configurable. */
const payrollPeriodSchema = createTenantSchema({
  name: { type: String, required: true }, // "August 2026"
  year: { type: Number, required: true, index: true },
  month: { type: Number, required: true, index: true },

  startDate: { type: String, required: true },
  endDate: { type: String, required: true },
  payDate: { type: String, required: true },

  /** The attendance window this period consumes. */
  attendanceFrom: { type: String, required: true },
  attendanceTo: { type: String, required: true },

  status: {
    type: String,
    enum: ["draft", "open", "processing", "processed", "approved", "locked", "paid"],
    default: "draft",
    index: true,
  },

  totalWorkingDays: { type: Number, default: 0 },
  lockedAt: { type: Date, default: null },
  lockedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
});

tenantUnique(payrollPeriodSchema, ["year", "month"]);

const PayrollPeriod = mongoose.model("PayrollPeriod", payrollPeriodSchema);

/** One execution of payroll for a period. */
const payrollRunSchema = createTenantSchema({
  periodId: { type: mongoose.Schema.Types.ObjectId, ref: "PayrollPeriod", required: true, index: true },
  runNumber: { type: Number, default: 1 },

  type: { type: String, enum: ["regular", "supplementary", "bonus", "arrear"], default: "regular" },

  status: {
    type: String,
    enum: ["draft", "processing", "processed", "failed", "approved", "locked", "paid", "cancelled"],
    default: "draft",
    index: true,
  },

  /** Narrow a run to part of the organization. */
  scope: {
    departmentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Department" }],
    locationIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Location" }],
    employeeIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Employee" }],
  },

  totals: {
    employeeCount: { type: Number, default: 0 },
    grossTotal: { type: Number, default: 0 },
    deductionTotal: { type: Number, default: 0 },
    netTotal: { type: Number, default: 0 },
    employerContributionTotal: { type: Number, default: 0 },
    ctcTotal: { type: Number, default: 0 },
  },

  processedAt: { type: Date, default: null },
  processedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  approvedAt: { type: Date, default: null },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  lockedAt: { type: Date, default: null },
  lockedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  paidAt: { type: Date, default: null },

  exceptions: {
    type: [{ employeeId: mongoose.Schema.Types.ObjectId, employeeCode: String, message: String }],
    default: [],
  },
  notes: { type: String, default: "" },
});

payrollRunSchema.index({ organizationId: 1, periodId: 1, status: 1 });

const PayrollRun = mongoose.model("PayrollRun", payrollRunSchema);

/**
 * One employee's calculated payroll for a run.
 *
 * The `breakdown` is the whole point: an employee asking "why is my deduction
 * ₹2,500" gets the working days, the present days, the formula, and the
 * intermediate values — not a number with no provenance.
 */
const payrollItemSchema = createTenantSchema({
  runId: { type: mongoose.Schema.Types.ObjectId, ref: "PayrollRun", required: true, index: true },
  periodId: { type: mongoose.Schema.Types.ObjectId, ref: "PayrollPeriod", required: true, index: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true, index: true },

  employeeSnapshot: {
    employeeCode: String,
    name: String,
    designation: String,
    department: String,
    location: String,
    joiningDate: Date,
    bankAccountLast4: String,
    paymentMode: String,
  },

  salaryId: { type: mongoose.Schema.Types.ObjectId, ref: "EmployeeSalary", default: null },
  structureId: { type: mongoose.Schema.Types.ObjectId, ref: "SalaryStructure", default: null },

  attendance: {
    totalDays: { type: Number, default: 0 },
    workingDays: { type: Number, default: 0 },
    payableDays: { type: Number, default: 0 },
    presentDays: { type: Number, default: 0 },
    paidLeaveDays: { type: Number, default: 0 },
    unpaidLeaveDays: { type: Number, default: 0 },
    absentDays: { type: Number, default: 0 },
    holidayDays: { type: Number, default: 0 },
    weeklyOffDays: { type: Number, default: 0 },
    lossOfPayDays: { type: Number, default: 0 },
    overtimeHours: { type: Number, default: 0 },
  },

  lines: {
    type: [
      {
        componentId: { type: mongoose.Schema.Types.ObjectId, ref: "SalaryComponent" },
        code: String,
        name: String,
        // A field literally named "type" must use the object form: a bare
        // `type: String` here is read by Mongoose as the array's element
        // type, which silently turned `lines` into [String] and made every
        // payroll run fail to save its items with a cast error.
        type: { type: String },
        category: String,
        /** Before attendance proration. */
        fullAmount: Number,
        /** What is actually paid this period. */
        amount: Number,
        prorated: Boolean,
        formula: String,
        explanation: String,
        showOnPayslip: Boolean,
        order: Number,
      },
    ],
    default: [],
  },

  /** Manual one-off additions or deductions for this period. */
  adjustments: {
    type: [
      {
        label: { type: String, required: true },
        type: { type: String, enum: ["earning", "deduction"], required: true },
        amount: { type: Number, required: true },
        reason: String,
        addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        addedAt: { type: Date, default: Date.now },
      },
    ],
    default: [],
  },

  gross: { type: Number, default: 0 },
  totalDeductions: { type: Number, default: 0 },
  employerContributions: { type: Number, default: 0 },
  net: { type: Number, default: 0 },
  ctc: { type: Number, default: 0 },

  /** Ordered trace of how the numbers were reached. */
  breakdown: { type: [{ rule: String, detail: String, effect: String }], default: [] },

  status: {
    type: String,
    enum: ["calculated", "on_hold", "excluded", "error"],
    default: "calculated",
  },
  holdReason: { type: String, default: "" },
  error: { type: String, default: null },
});

tenantUnique(payrollItemSchema, ["runId", "employeeId"]);
payrollItemSchema.index({ organizationId: 1, employeeId: 1, periodId: 1 });

const PayrollItem = mongoose.model("PayrollItem", payrollItemSchema);

/** A published payslip. Immutable once issued. */
const payslipSchema = createTenantSchema({
  itemId: { type: mongoose.Schema.Types.ObjectId, ref: "PayrollItem", required: true },
  runId: { type: mongoose.Schema.Types.ObjectId, ref: "PayrollRun", required: true, index: true },
  periodId: { type: mongoose.Schema.Types.ObjectId, ref: "PayrollPeriod", required: true, index: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true, index: true },

  payslipNumber: { type: String, required: true },
  periodLabel: { type: String, required: true },

  gross: { type: Number, required: true },
  totalDeductions: { type: Number, required: true },
  net: { type: Number, required: true },

  /** Frozen copy of the item, so a later recalculation cannot rewrite history. */
  snapshot: { type: mongoose.Schema.Types.Mixed, required: true },

  fileId: { type: mongoose.Schema.Types.ObjectId, ref: "StoredFile", default: null },

  publishedAt: { type: Date, default: Date.now },
  publishedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  viewedAt: { type: Date, default: null },
  downloadedAt: { type: Date, default: null },
});

tenantUnique(payslipSchema, ["employeeId", "periodId"]);
payslipSchema.index({ organizationId: 1, employeeId: 1, publishedAt: -1 });

const Payslip = mongoose.model("Payslip", payslipSchema);

module.exports = {
  SalaryComponent,
  SalaryStructure,
  EmployeeSalary,
  PayrollPeriod,
  PayrollRun,
  PayrollItem,
  Payslip,
};
