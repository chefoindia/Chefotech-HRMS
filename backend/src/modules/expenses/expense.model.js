"use strict";

const mongoose = require("mongoose");
const { createTenantSchema } = require("../../core/tenancy/baseSchema");

/**
 * An expense claim: one or more items with receipts, approved by the
 * manager (or anyone with expense.approve), then reimbursed — either marked
 * paid by finance or handed to payroll as an earning on the next payslip.
 */
const lineSchema = new mongoose.Schema(
  {
    date: { type: String, required: true }, // YYYY-MM-DD
    category: { type: String, required: true, trim: true, maxlength: 60 },
    description: { type: String, default: "", maxlength: 300 },
    amount: { type: Number, required: true, min: 0 },
    receiptFileId: { type: mongoose.Schema.Types.ObjectId, ref: "StoredFile", default: null },
    /** Distance claims: km × rate. */
    distanceKm: { type: Number, default: null },
  },
  { _id: true }
);

const expenseSchema = createTenantSchema({
  number: { type: Number, required: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  purpose: { type: String, default: "", maxlength: 1000 },
  currency: { type: String, default: null },
  lines: { type: [lineSchema], default: [] },
  total: { type: Number, default: 0 },
  /** An advance already paid against this claim, netted off on reimbursement. */
  advanceAmount: { type: Number, default: 0 },

  status: {
    type: String,
    enum: ["draft", "submitted", "approved", "rejected", "reimbursed", "cancelled"],
    default: "draft",
    index: true,
  },
  submittedAt: { type: Date, default: null },

  approverUserIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  workflowInstanceId: { type: mongoose.Schema.Types.ObjectId, ref: "WorkflowInstance", default: null },
  decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  decidedByName: { type: String, default: "" },
  decidedAt: { type: Date, default: null },
  decisionComment: { type: String, default: "" },
  /** The approver may trim a claim; what is paid is approvedTotal. */
  approvedTotal: { type: Number, default: null },

  reimbursement: {
    method: { type: String, enum: ["payroll", "bank_transfer", "cash", "other"], default: null },
    paidAt: { type: Date, default: null },
    reference: { type: String, default: "" },
    payrollInputId: { type: mongoose.Schema.Types.ObjectId, ref: "PayrollInput", default: null },
    paidBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
});

expenseSchema.index({ organizationId: 1, number: 1 }, { unique: true });
expenseSchema.index({ organizationId: 1, status: 1, submittedAt: -1 });
expenseSchema.index({ organizationId: 1, employeeId: 1, createdAt: -1 });

const ExpenseClaim = mongoose.model("ExpenseClaim", expenseSchema);

module.exports = { ExpenseClaim };
