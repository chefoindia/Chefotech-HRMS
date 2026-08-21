"use strict";

const mongoose = require("mongoose");
const { createTenantSchema, tenantUnique } = require("../../core/tenancy/baseSchema");

/**
 * A punch: one in/out event attributed to an employee.
 *
 * Separate from the raw biometric event on purpose. A BiometricEvent is what
 * the device said, immutable and never edited. A Punch is what we decided that
 * means for a person — after mapping the device id to an employee, discarding
 * duplicates, and applying corrections. Reprocessing rebuilds punches from raw
 * events without ever losing the original.
 */
const punchSchema = createTenantSchema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
      index: true,
    },
    /** The calendar date this punch is attributed to, in the org's timezone. */
    date: { type: String, required: true, index: true },
    at: { type: Date, required: true },

    direction: { type: String, enum: ["in", "out", null], default: null },
    source: {
      type: String,
      enum: ["biometric", "web", "mobile", "manual", "import", "api"],
      required: true,
    },

    deviceId: { type: mongoose.Schema.Types.ObjectId, ref: "BiometricDevice", default: null },
    rawEventId: { type: mongoose.Schema.Types.ObjectId, ref: "BiometricEvent", default: null },

    location: {
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
      accuracy: { type: Number, default: null },
      address: { type: String, default: null },
      isWithinGeofence: { type: Boolean, default: null },
    },
    ip: { type: String, default: null },
    note: { type: String, default: "" },

    /** Added by a correction rather than captured. */
    isManual: { type: Boolean, default: false },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { softDelete: false }
);

punchSchema.index({ organizationId: 1, employeeId: 1, date: 1, at: 1 });
// The same device event must never create two punches, however many times a
// sync is re-run. This is the index that makes biometric imports idempotent.
punchSchema.index(
  { organizationId: 1, employeeId: 1, at: 1, source: 1 },
  { unique: true }
);

const Punch = mongoose.model("Punch", punchSchema);

/**
 * The computed attendance for one employee on one day.
 *
 * Derived state: it can always be rebuilt from punches + policy + calendar.
 * The `breakdown` records which rules produced this result, so the figure is
 * explainable months later even if the policy has changed since.
 */
const attendanceRecordSchema = createTenantSchema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
      index: true,
    },
    date: { type: String, required: true, index: true },

    status: {
      type: String,
      enum: [
        "present", "absent", "half_day", "weekly_off", "holiday",
        "leave", "on_duty", "work_from_home", "comp_off", "pending", "not_applicable",
      ],
      required: true,
      index: true,
    },

    shiftId: { type: mongoose.Schema.Types.ObjectId, ref: "Shift", default: null },
    shiftCode: { type: String, default: null },
    scheduledStart: { type: Date, default: null },
    scheduledEnd: { type: Date, default: null },
    scheduledMinutes: { type: Number, default: 0 },

    firstPunchAt: { type: Date, default: null },
    lastPunchAt: { type: Date, default: null },
    punchCount: { type: Number, default: 0 },

    workedMinutes: { type: Number, default: 0 },
    breakMinutes: { type: Number, default: 0 },
    effectiveMinutes: { type: Number, default: 0 },

    lateByMinutes: { type: Number, default: 0 },
    earlyLeavingByMinutes: { type: Number, default: 0 },
    overtimeMinutes: { type: Number, default: 0 },
    overtimeRate: { type: Number, default: null },
    overtimeStatus: {
      type: String,
      enum: ["none", "pending", "approved", "rejected"],
      default: "none",
    },
    overtimeApprovedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    isLate: { type: Boolean, default: false },
    isEarlyLeaving: { type: Boolean, default: false },
    isMissingPunch: { type: Boolean, default: false, index: true },
    isHoliday: { type: Boolean, default: false },
    isWeeklyOff: { type: Boolean, default: false },

    holidayName: { type: String, default: null },
    leaveType: { type: String, default: null },
    leaveRequestId: { type: mongoose.Schema.Types.ObjectId, ref: "LeaveRequest", default: null },
    leavePortion: { type: String, default: null },

    /** What payroll consumes. 0, 0.5 or 1 for a normal day. */
    payableDays: { type: Number, default: 0 },
    compOffEarnedDays: { type: Number, default: 0 },
    lateMarkNumber: { type: Number, default: null },
    lateMarkApplied: { type: Boolean, default: false },

    /** Ordered trace of the rules that produced this result. */
    breakdown: {
      type: [{ rule: String, detail: String, effect: String }],
      default: [],
    },

    isManualOverride: { type: Boolean, default: false },
    overrideReason: { type: String, default: "" },
    overriddenBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    /** Locked days are frozen for payroll and cannot be recomputed. */
    isLocked: { type: Boolean, default: false, index: true },
    lockedAt: { type: Date, default: null },
    lockedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

    policyId: { type: mongoose.Schema.Types.ObjectId, ref: "AttendancePolicy", default: null },
    computedAt: { type: Date, default: Date.now },
  },
  { softDelete: false }
);

// One record per employee per day. This is the constraint that makes
// reprocessing an upsert instead of a duplicate-generating insert.
tenantUnique(attendanceRecordSchema, ["employeeId", "date"]);
attendanceRecordSchema.index({ organizationId: 1, date: 1, status: 1 });
attendanceRecordSchema.index({ organizationId: 1, employeeId: 1, date: -1 });
attendanceRecordSchema.index({ organizationId: 1, date: 1, isLocked: 1 });

const AttendanceRecord = mongoose.model("AttendanceRecord", attendanceRecordSchema);

/** A request to change a day's attendance. Goes through the workflow engine. */
const attendanceCorrectionSchema = createTenantSchema({
  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Employee",
    required: true,
    index: true,
  },
  date: { type: String, required: true, index: true },

  type: {
    type: String,
    enum: ["missing_punch", "wrong_punch", "forgot_to_punch", "on_duty", "work_from_home", "other"],
    required: true,
  },

  /** What the employee is asking for. */
  requested: {
    checkIn: { type: String, default: null }, // "HH:mm"
    checkOut: { type: String, default: null },
    status: { type: String, default: null },
  },
  /** Snapshot of the record before the change, for the audit trail. */
  previous: { type: mongoose.Schema.Types.Mixed, default: null },

  reason: { type: String, required: true },
  attachmentFileId: { type: mongoose.Schema.Types.ObjectId, ref: "StoredFile", default: null },

  status: {
    type: String,
    enum: ["pending", "approved", "rejected", "cancelled"],
    default: "pending",
    index: true,
  },
  workflowInstanceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "WorkflowInstance",
    default: null,
  },

  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  reviewedAt: { type: Date, default: null },
  reviewComment: { type: String, default: "" },

  appliedAt: { type: Date, default: null },
});

attendanceCorrectionSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
attendanceCorrectionSchema.index({ organizationId: 1, employeeId: 1, date: 1 });

const AttendanceCorrection = mongoose.model("AttendanceCorrection", attendanceCorrectionSchema);

/** A locked attendance period. Payroll depends on this not moving. */
const attendanceLockSchema = createTenantSchema({
  fromDate: { type: String, required: true },
  toDate: { type: String, required: true },
  reason: { type: String, default: "" },
  lockedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  unlockedAt: { type: Date, default: null },
  unlockedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  unlockReason: { type: String, default: "" },
});

attendanceLockSchema.index({ organizationId: 1, fromDate: 1, toDate: 1 });

const AttendanceLock = mongoose.model("AttendanceLock", attendanceLockSchema);

module.exports = { Punch, AttendanceRecord, AttendanceCorrection, AttendanceLock };
