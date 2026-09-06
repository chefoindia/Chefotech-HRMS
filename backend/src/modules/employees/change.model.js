"use strict";

const mongoose = require("mongoose");
const { createTenantSchema } = require("../../core/tenancy/baseSchema");

/**
 * A movement on an employee's record with an effective date: a promotion,
 * a transfer, a new manager, a confirmation of probation. Recorded as its
 * own row so the history is queryable ("when was she promoted?") and so a
 * change dated next month applies itself on the day, not when it was typed.
 */
const CHANGE_TYPES = ["promotion", "transfer", "designation", "department", "manager", "location", "employment_type", "shift", "confirmation", "probation_extension", "work_mode"];

const changeSchema = createTenantSchema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
  type: { type: String, enum: CHANGE_TYPES, required: true, index: true },
  effectiveDate: { type: String, required: true, index: true },
  /** The employment fields to set — designationId, departmentId, managerId, locationId, employmentType, shiftId, confirmationDate, probationMonths, workMode. */
  changes: { type: mongoose.Schema.Types.Mixed, default: {} },
  /** What it was, captured when applied. */
  previous: { type: mongoose.Schema.Types.Mixed, default: null },
  reason: { type: String, default: "", maxlength: 1000 },
  /** Optional letter to generate on application, by template code. */
  letterTemplateCode: { type: String, default: null },
  letterDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: "EmployeeDocument", default: null },
  /** A salary revision recorded alongside a promotion. */
  salaryRevision: {
    structureId: { type: mongoose.Schema.Types.ObjectId, ref: "SalaryStructure", default: null },
    ctcAnnual: { type: Number, default: null },
    componentAmounts: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  status: { type: String, enum: ["scheduled", "applied", "cancelled", "failed"], default: "scheduled", index: true },
  appliedAt: { type: Date, default: null },
  error: { type: String, default: null },
});

changeSchema.index({ organizationId: 1, status: 1, effectiveDate: 1 });

const EmployeeChange = mongoose.model("EmployeeChange", changeSchema);

module.exports = { EmployeeChange, CHANGE_TYPES };
