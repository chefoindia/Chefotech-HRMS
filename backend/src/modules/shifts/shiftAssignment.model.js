"use strict";

const mongoose = require("mongoose");
const { createTenantSchema } = require("../../core/tenancy/baseSchema");

/**
 * A dated override of an employee's shift.
 *
 * The employee's own `employment.shiftId` is their standing shift; this
 * collection records rosters and rotations on top of it. Attendance resolves a
 * day's shift as: assignment for that date → employee's shift → org default.
 * Keeping overrides dated (rather than mutating the employee) is what makes
 * last month's attendance still calculable against last month's roster.
 */
const shiftAssignmentSchema = createTenantSchema({
  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Employee",
    required: true,
    index: true,
  },
  shiftId: { type: mongoose.Schema.Types.ObjectId, ref: "Shift", required: true },

  /** Inclusive calendar dates, "YYYY-MM-DD". */
  fromDate: { type: String, required: true, index: true },
  toDate: { type: String, required: true, index: true },

  reason: { type: String, default: "" },
  source: {
    type: String,
    enum: ["manual", "rotation", "import"],
    default: "manual",
  },
  rotationId: { type: mongoose.Schema.Types.ObjectId, ref: "ShiftRotation", default: null },
});

shiftAssignmentSchema.index({ organizationId: 1, employeeId: 1, fromDate: 1, toDate: 1 });

module.exports = mongoose.model("ShiftAssignment", shiftAssignmentSchema);
