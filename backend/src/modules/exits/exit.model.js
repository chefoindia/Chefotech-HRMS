"use strict";

const mongoose = require("mongoose");
const { createTenantSchema } = require("../../core/tenancy/baseSchema");

/**
 * An exit: from "I resign" (or "we are letting you go") through notice,
 * clearance and settlement to the last day.
 *
 * The employee record's `exit` block holds the headline facts; this holds
 * the process — who has cleared what, and the settlement as agreed.
 */
const EXIT_TYPES = ["resignation", "termination", "retirement", "end_of_contract", "absconded"];
const TASK_OWNERS = ["hr", "it", "finance", "admin", "manager", "employee"];

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, maxlength: 160 },
    description: { type: String, default: "", maxlength: 1000 },
    owner: { type: String, enum: TASK_OWNERS, default: "hr" },
    assigneeUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    status: { type: String, enum: ["pending", "done", "skipped"], default: "pending" },
    completedAt: { type: Date, default: null },
    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    note: { type: String, default: "", maxlength: 500 },
    /** Recovery raised while clearing (unreturned asset, pending advance). */
    recoveryAmount: { type: Number, default: 0 },
  },
  { _id: true }
);

const exitSchema = createTenantSchema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
  type: { type: String, enum: EXIT_TYPES, required: true },
  reason: { type: String, default: "", maxlength: 2000 },
  /** Set by the employee on a resignation; HR may move it. */
  proposedLastDay: { type: String, default: null },
  lastWorkingDay: { type: String, default: null, index: true },
  resignationDate: { type: String, default: null },
  noticePeriodDays: { type: Number, default: null },
  noticeWaived: { type: Boolean, default: false },
  noticeShortfallDays: { type: Number, default: 0 },
  isRehirable: { type: Boolean, default: true },

  status: {
    type: String,
    enum: ["requested", "accepted", "in_progress", "completed", "rejected", "withdrawn", "cancelled"],
    default: "requested",
    index: true,
  },
  initiatedBy: { type: String, enum: ["employee", "hr"], default: "employee" },
  decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  decidedAt: { type: Date, default: null },
  decisionComment: { type: String, default: "" },

  tasks: { type: [taskSchema], default: [] },
  exitInterviewNotes: { type: String, default: "", maxlength: 5000 },

  settlement: {
    computedAt: { type: Date, default: null },
    dues: { type: [{ label: String, detail: String, amount: Number }], default: [] },
    recoveries: { type: [{ label: String, detail: String, amount: Number }], default: [] },
    totalDues: { type: Number, default: 0 },
    totalRecoveries: { type: Number, default: 0 },
    net: { type: Number, default: 0 },
    /** Once the settlement is agreed it is filed as a payroll input. */
    payrollInputId: { type: mongoose.Schema.Types.ObjectId, ref: "PayrollInput", default: null },
    settledAt: { type: Date, default: null },
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: "EmployeeDocument", default: null },
  },

  completedAt: { type: Date, default: null },
});

exitSchema.index({ organizationId: 1, status: 1, lastWorkingDay: 1 });

const Exit = mongoose.model("EmployeeExit", exitSchema);

/** The default clearance list; organizations can override it in settings. */
const DEFAULT_TASKS = [
  { title: "Knowledge transfer and handover", owner: "manager" },
  { title: "Return laptop, phone and accessories", owner: "it" },
  { title: "Revoke system access and email", owner: "it" },
  { title: "Return ID card and access card", owner: "admin" },
  { title: "Settle advances and expense claims", owner: "finance" },
  { title: "Exit interview", owner: "hr" },
  { title: "Issue relieving and experience letters", owner: "hr" },
];

module.exports = { Exit, EXIT_TYPES, TASK_OWNERS, DEFAULT_TASKS };
