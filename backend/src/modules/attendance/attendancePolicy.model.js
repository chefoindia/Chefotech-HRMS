"use strict";

const mongoose = require("mongoose");
const { createTenantSchema, tenantUnique } = require("../../core/tenancy/baseSchema");

/**
 * An attendance policy: every threshold the engine consults, as data.
 *
 * This is the file that makes the difference between "an HRMS" and "an HRMS
 * for one company". Nothing in attendanceEngine.js contains a number — grace
 * periods, half-day cut-offs, overtime multipliers and late-mark conversion
 * all come from here, so Company A marking late after 10 minutes and Company B
 * after 15 requires no code, no deployment, and no branch on organizationId.
 *
 * Policies are assigned per employee (falling back to the default), so one
 * organization can run a strict factory-floor policy and a lenient policy for
 * the design team at the same time.
 */
const attendancePolicySchema = createTenantSchema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true, uppercase: true },
  description: { type: String, default: "" },

  // ── Arrival ─────────────────────────────────────────────────────────────
  arrival: {
    /** Minutes after shift start that are simply forgiven. */
    graceMinutes: { type: Number, default: 10, min: 0, max: 240 },
    /** Beyond grace, arriving within this window is a "late mark". */
    lateAfterMinutes: { type: Number, default: 0, min: 0, max: 480 },
    /** Arriving later than this is treated as a half day regardless of hours. */
    halfDayAfterMinutes: { type: Number, default: 240, min: 0, max: 720 },
    /** Later still: the day is an absence. 0 disables. */
    absentAfterMinutes: { type: Number, default: 0, min: 0, max: 720 },
    /** Allow a punch before shift start to count as on time. */
    earlyArrivalCountsAsOvertime: { type: Boolean, default: false },
  },

  // ── Departure ───────────────────────────────────────────────────────────
  departure: {
    graceMinutes: { type: Number, default: 10, min: 0, max: 240 },
    /** Leaving more than this before shift end is "early leaving". */
    earlyLeavingAfterMinutes: { type: Number, default: 0, min: 0, max: 480 },
    /** Leaving this early makes it a half day. */
    halfDayBeforeMinutes: { type: Number, default: 240, min: 0, max: 720 },
  },

  // ── Working hours ───────────────────────────────────────────────────────
  hours: {
    /**
     * How a day is classified once the worked minutes are known.
     *   shift_based  — thresholds are a percentage of the scheduled shift
     *   fixed_hours  — thresholds are absolute minutes
     */
    basis: { type: String, enum: ["shift_based", "fixed_hours"], default: "shift_based" },

    /** Used when basis = fixed_hours. */
    fullDayMinutes: { type: Number, default: 480, min: 60, max: 1440 },
    halfDayMinutes: { type: Number, default: 240, min: 30, max: 720 },

    /** Used when basis = shift_based, as a percentage of the shift duration. */
    fullDayPercent: { type: Number, default: 90, min: 10, max: 100 },
    halfDayPercent: { type: Number, default: 45, min: 5, max: 100 },

    /** Below this the day is an absence even if a punch exists. */
    minimumMinutesForPresence: { type: Number, default: 60, min: 0, max: 720 },
  },

  // ── Breaks ──────────────────────────────────────────────────────────────
  breaks: {
    /**
     * first_last  — only the first and last punch matter; break is the shift's
     *               nominal break, deducted if unpaid.
     * paired      — every in/out pair is a work session; gaps are breaks.
     */
    calculation: { type: String, enum: ["first_last", "paired"], default: "first_last" },
    maxBreakMinutes: { type: Number, default: 60, min: 0, max: 480 },
    /** Deduct break time beyond the allowance from worked hours. */
    deductExcessBreak: { type: Boolean, default: true },
  },

  // ── Late marks ──────────────────────────────────────────────────────────
  lateMarks: {
    enabled: { type: Boolean, default: false },
    /** How many late marks convert into a deduction. */
    countForDeduction: { type: Number, default: 3, min: 1, max: 30 },
    deductionType: {
      type: String,
      enum: ["half_day", "full_day", "leave"],
      default: "half_day",
    },
    /** When the counter resets. */
    resetPeriod: { type: String, enum: ["monthly", "quarterly", "yearly"], default: "monthly" },
  },

  // ── Overtime ────────────────────────────────────────────────────────────
  overtime: {
    enabled: { type: Boolean, default: false },
    /** Minutes past the shift end before overtime starts accruing. */
    startsAfterMinutes: { type: Number, default: 30, min: 0, max: 480 },
    /** Ignore overtime shorter than this. */
    minimumMinutes: { type: Number, default: 30, min: 0, max: 480 },
    maximumMinutesPerDay: { type: Number, default: 240, min: 0, max: 960 },
    /** Round accrued overtime down to this block. 0 = no rounding. */
    roundToMinutes: { type: Number, default: 30, min: 0, max: 120 },
    requiresApproval: { type: Boolean, default: true },
    /** Multipliers used by payroll. */
    normalDayRate: { type: Number, default: 1.5, min: 0, max: 5 },
    weeklyOffRate: { type: Number, default: 2, min: 0, max: 5 },
    holidayRate: { type: Number, default: 2, min: 0, max: 5 },
  },

  // ── Days off ────────────────────────────────────────────────────────────
  weeklyOff: {
    /** Working on a weekly off earns compensatory time off. */
    grantsCompOff: { type: Boolean, default: false },
    /** Minimum minutes worked to earn a full comp off. */
    compOffFullDayMinutes: { type: Number, default: 480 },
    compOffHalfDayMinutes: { type: Number, default: 240 },
    countsAsOvertime: { type: Boolean, default: true },
  },
  holiday: {
    grantsCompOff: { type: Boolean, default: true },
    countsAsOvertime: { type: Boolean, default: true },
  },

  // ── Missing punches ─────────────────────────────────────────────────────
  missingPunch: {
    /** What a day with an in but no out becomes before anyone intervenes. */
    treatAs: {
      type: String,
      enum: ["absent", "half_day", "present", "pending"],
      default: "pending",
    },
    /** Auto-close the day at shift end instead of leaving it open. */
    autoCloseAtShiftEnd: { type: Boolean, default: false },
    notifyEmployee: { type: Boolean, default: true },
  },

  // ── Regularization ──────────────────────────────────────────────────────
  regularization: {
    enabled: { type: Boolean, default: true },
    /** How far back an employee may request a correction. */
    windowDays: { type: Number, default: 7, min: 0, max: 90 },
    /** Cap on requests per month, to stop it becoming a rubber stamp. */
    maxPerMonth: { type: Number, default: 3, min: 0, max: 31 },
    requiresApproval: { type: Boolean, default: true },
  },

  isDefault: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
});

tenantUnique(attendancePolicySchema, "code");

attendancePolicySchema.pre("save", async function enforceSingleDefault(next) {
  if (this.isDefault && this.isModified("isDefault")) {
    await this.constructor.updateMany(
      { _id: { $ne: this._id }, isDefault: true },
      { $set: { isDefault: false } }
    );
  }
  next();
});

module.exports = mongoose.model("AttendancePolicy", attendancePolicySchema);
