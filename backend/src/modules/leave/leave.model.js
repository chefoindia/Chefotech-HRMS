"use strict";

const mongoose = require("mongoose");
const { createTenantSchema, tenantUnique } = require("../../core/tenancy/baseSchema");

/**
 * Leave types are tenant-defined. The platform ships sensible starters
 * (Casual, Sick, Earned, Comp Off, Unpaid) but a customer can rename them,
 * delete them, or invent "Menstrual Leave" and "Sabbatical" — the engine never
 * looks for a type by name.
 */
const leaveTypeSchema = createTenantSchema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true, uppercase: true },
  description: { type: String, default: "" },
  colour: { type: String, default: "#6366F1" },

  isPaid: { type: Boolean, default: true },
  /** Deducted from a balance, vs. unlimited (e.g. unpaid leave). */
  hasBalance: { type: Boolean, default: true },

  /** Comp off is credited by attendance rather than allocated by policy. */
  isCompOff: { type: Boolean, default: false },
  /** Excluded from most reports and from the leave calendar. */
  isSpecial: { type: Boolean, default: false },

  unit: { type: String, enum: ["day", "hour"], default: "day" },
  allowHalfDay: { type: Boolean, default: true },
  allowHourly: { type: Boolean, default: false },

  requiresAttachment: { type: Boolean, default: false },
  /** Attachment becomes mandatory beyond this many consecutive days. */
  attachmentRequiredAfterDays: { type: Number, default: 0 },

  // ── Eligibility ─────────────────────────────────────────────────────────
  eligibility: {
    genders: { type: [String], default: [] }, // empty = everyone
    employmentTypes: { type: [String], default: [] },
    departmentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Department" }],
    locationIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Location" }],
    /** Months of service before this leave can be taken. */
    minimumServiceMonths: { type: Number, default: 0 },
    availableDuringProbation: { type: Boolean, default: true },
    availableDuringNotice: { type: Boolean, default: true },
  },

  isActive: { type: Boolean, default: true, index: true },
  order: { type: Number, default: 100 },
});

tenantUnique(leaveTypeSchema, "code");

const LeaveType = mongoose.model("LeaveType", leaveTypeSchema);

/**
 * A leave policy binds allocation and consumption rules to leave types.
 *
 * Every number here is why "Company A gives 12 CL a year, Company B gives 10,
 * Company C accrues monthly" needs no code change.
 */
const leaveRuleSchema = new mongoose.Schema(
  {
    leaveTypeId: { type: mongoose.Schema.Types.ObjectId, ref: "LeaveType", required: true },

    // ── Allocation ────────────────────────────────────────────────────────
    allocation: {
      mode: {
        type: String,
        enum: ["annual", "monthly", "quarterly", "accrual", "unlimited", "none"],
        default: "annual",
      },
      /** Days per allocation period. */
      daysPerPeriod: { type: Number, default: 12 },
      /** Accrual mode: days earned per completed month of service. */
      accrualPerMonth: { type: Number, default: 1 },
      /** Credit at the start of the period, or at the end of each unit. */
      creditTiming: { type: String, enum: ["advance", "arrears"], default: "advance" },
      /** New joiners get a share of the year proportional to their start date. */
      prorateOnJoining: { type: Boolean, default: true },
      prorateOnExit: { type: Boolean, default: true },
      /** Round the prorated figure. */
      rounding: {
        type: String,
        enum: ["none", "up", "down", "nearest_half", "nearest_whole"],
        default: "nearest_half",
      },
      maximumBalance: { type: Number, default: 0 }, // 0 = uncapped
    },

    // ── Carry forward and encashment ──────────────────────────────────────
    carryForward: {
      enabled: { type: Boolean, default: false },
      maximumDays: { type: Number, default: 0 },
      /** Carried days lapse this many months into the new year. 0 = never. */
      expiryMonths: { type: Number, default: 0 },
    },
    encashment: {
      enabled: { type: Boolean, default: false },
      maximumDays: { type: Number, default: 0 },
      /** Only balance above this is encashable. */
      minimumBalanceToRetain: { type: Number, default: 0 },
      onExitOnly: { type: Boolean, default: true },
    },

    // ── Application rules ─────────────────────────────────────────────────
    application: {
      minimumDaysPerRequest: { type: Number, default: 0.5 },
      maximumDaysPerRequest: { type: Number, default: 0 }, // 0 = uncapped
      maximumRequestsPerYear: { type: Number, default: 0 },
      /** Days of notice required before the leave starts. */
      noticeDays: { type: Number, default: 0 },
      allowBackdated: { type: Boolean, default: true },
      backdatedLimitDays: { type: Number, default: 30 },
      allowNegativeBalance: { type: Boolean, default: false },
      maximumNegativeDays: { type: Number, default: 0 },
      /** Prevent two people in a team being off at once. 0 = no limit. */
      maximumConcurrentInTeam: { type: Number, default: 0 },
    },

    // ── How days are counted ──────────────────────────────────────────────
    counting: {
      /**
       * The sandwich rule. When leave spans a weekend or holiday:
       *   exclude  — days off in the middle are free (the humane default)
       *   include  — every calendar day is deducted
       *   sandwich — days off are deducted ONLY when the leave surrounds them
       *              on both sides, which is what "sandwich policy" means in
       *              Indian HR practice and what most factories run.
       */
      holidays: { type: String, enum: ["exclude", "include", "sandwich"], default: "exclude" },
      weeklyOffs: { type: String, enum: ["exclude", "include", "sandwich"], default: "exclude" },
    },

    // ── Approval ──────────────────────────────────────────────────────────
    approval: {
      required: { type: Boolean, default: true },
      /** Beyond this many days, escalate to the next level. 0 = never. */
      escalateAfterDays: { type: Number, default: 0 },
      workflowId: { type: mongoose.Schema.Types.ObjectId, ref: "Workflow", default: null },
      autoApprove: { type: Boolean, default: false },
    },
  },
  { _id: true }
);

const leavePolicySchema = createTenantSchema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true, uppercase: true },
  description: { type: String, default: "" },

  rules: { type: [leaveRuleSchema], default: [] },

  /** Leave year start month, 1–12. Overrides the org setting when set. */
  yearStartMonth: { type: Number, default: null, min: 1, max: 12 },

  isDefault: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  employeeCount: { type: Number, default: 0 },
});

tenantUnique(leavePolicySchema, "code");

leavePolicySchema.pre("save", async function enforceSingleDefault(next) {
  if (this.isDefault && this.isModified("isDefault")) {
    await this.constructor.updateMany(
      { _id: { $ne: this._id }, isDefault: true },
      { $set: { isDefault: false } }
    );
  }
  next();
});

const LeavePolicy = mongoose.model("LeavePolicy", leavePolicySchema);

/**
 * One employee's balance of one leave type for one leave year.
 *
 * Every component is stored separately rather than a single `balance` number,
 * so the figure is explainable: opening + allocated + carried + credited −
 * used − encashed − lapsed = available. A balance nobody can account for is a
 * balance an employee will dispute.
 */
const leaveBalanceSchema = createTenantSchema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
  leaveTypeId: { type: mongoose.Schema.Types.ObjectId, ref: "LeaveType", required: true, index: true },
  /** The leave year, identified by its starting calendar year. */
  year: { type: Number, required: true, index: true },
  periodStart: { type: String, required: true },
  periodEnd: { type: String, required: true },

  opening: { type: Number, default: 0 },
  allocated: { type: Number, default: 0 },
  carriedForward: { type: Number, default: 0 },
  credited: { type: Number, default: 0 }, // comp off, manual credits
  used: { type: Number, default: 0 },
  pending: { type: Number, default: 0 }, // applied but not yet approved
  encashed: { type: Number, default: 0 },
  lapsed: { type: Number, default: 0 },
  adjustment: { type: Number, default: 0 }, // manual correction, can be negative

  lastAccruedMonth: { type: Number, default: null },

  history: {
    type: [
      {
        at: { type: Date, default: Date.now },
        type: {
          type: String,
          enum: ["allocation", "accrual", "carry_forward", "credit", "usage", "cancellation", "encashment", "lapse", "adjustment"],
        },
        days: Number,
        balanceAfter: Number,
        reference: String,
        note: String,
        byUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      },
    ],
    default: [],
  },
});

tenantUnique(leaveBalanceSchema, ["employeeId", "leaveTypeId", "year"]);
leaveBalanceSchema.index({ organizationId: 1, year: 1, leaveTypeId: 1 });

/** available = everything credited, minus everything consumed or reserved. */
leaveBalanceSchema.virtual("available").get(function available() {
  return round2(
    this.opening +
      this.allocated +
      this.carriedForward +
      this.credited +
      this.adjustment -
      this.used -
      this.pending -
      this.encashed -
      this.lapsed
  );
});

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const LeaveBalance = mongoose.model("LeaveBalance", leaveBalanceSchema);

const leaveRequestSchema = createTenantSchema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
  leaveTypeId: { type: mongoose.Schema.Types.ObjectId, ref: "LeaveType", required: true },

  fromDate: { type: String, required: true, index: true },
  toDate: { type: String, required: true, index: true },
  fromPortion: { type: String, enum: ["full", "first_half", "second_half"], default: "full" },
  toPortion: { type: String, enum: ["full", "first_half", "second_half"], default: "full" },

  /** Calendar days spanned, vs. days actually deducted after the rules run. */
  calendarDays: { type: Number, required: true },
  leaveDays: { type: Number, required: true },

  reason: { type: String, required: true },
  contactDuringLeave: { type: String, default: "" },
  handoverToEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },
  attachmentFileId: { type: mongoose.Schema.Types.ObjectId, ref: "StoredFile", default: null },

  status: {
    type: String,
    enum: ["draft", "pending", "approved", "rejected", "cancelled", "withdrawn"],
    default: "pending",
    index: true,
  },

  workflowInstanceId: { type: mongoose.Schema.Types.ObjectId, ref: "WorkflowInstance", default: null },
  approvals: {
    type: [
      {
        level: Number,
        approverUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        approverName: String,
        decision: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
        comment: String,
        decidedAt: Date,
      },
    ],
    default: [],
  },

  appliedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  /** Set when HR applies on someone's behalf. */
  appliedOnBehalf: { type: Boolean, default: false },

  rejectionReason: { type: String, default: "" },
  cancellationReason: { type: String, default: "" },
  cancelledAt: { type: Date, default: null },

  /** Snapshot of the rule set at application time, for later explanation. */
  calculation: { type: mongoose.Schema.Types.Mixed, default: null },
});

leaveRequestSchema.index({ organizationId: 1, employeeId: 1, fromDate: -1 });
leaveRequestSchema.index({ organizationId: 1, status: 1, fromDate: -1 });

const LeaveRequest = mongoose.model("LeaveRequest", leaveRequestSchema);

/**
 * One row per employee per leave date.
 *
 * Exploding a request into days is what lets attendance ask "is this person on
 * leave on the 14th" with a single indexed lookup instead of a range scan over
 * every request, and it makes half-day portions exact.
 */
const leaveDaySchema = createTenantSchema(
  {
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
    leaveRequestId: { type: mongoose.Schema.Types.ObjectId, ref: "LeaveRequest", required: true, index: true },
    leaveTypeId: { type: mongoose.Schema.Types.ObjectId, ref: "LeaveType", required: true },

    date: { type: String, required: true, index: true },
    dayPortion: { type: String, enum: ["full", "first_half", "second_half"], default: "full" },
    /** 0 when the day fell on a holiday or weekly off that the policy excludes. */
    deductedDays: { type: Number, default: 1 },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "cancelled"],
      default: "pending",
      index: true,
    },
    isNonWorkingDay: { type: Boolean, default: false },
    nonWorkingReason: { type: String, default: null },
  },
  { softDelete: false }
);

leaveDaySchema.index({ organizationId: 1, employeeId: 1, date: 1, status: 1 });
tenantUnique(leaveDaySchema, ["leaveRequestId", "date"]);

const LeaveDay = mongoose.model("LeaveDay", leaveDaySchema);

module.exports = { LeaveType, LeavePolicy, LeaveBalance, LeaveRequest, LeaveDay };
