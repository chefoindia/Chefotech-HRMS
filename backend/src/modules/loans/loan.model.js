"use strict";

const mongoose = require("mongoose");
const { createTenantSchema } = require("../../core/tenancy/baseSchema");

/**
 * Loans and salary advances, recovered through payroll.
 *
 * On approval the whole instalment schedule is filed as payroll inputs,
 * one per period. Each run picks up the instalment due; the loan's
 * outstanding balance is simply what has not yet been applied. Closing a
 * loan early cancels the remaining inputs.
 */
const loanSchema = createTenantSchema({
  number: { type: Number, required: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
  type: { type: String, enum: ["loan", "advance"], default: "loan" },
  purpose: { type: String, default: "", maxlength: 500 },

  principal: { type: Number, required: true, min: 1 },
  /** Flat annual rate; 0 for interest-free, which is the common case. */
  interestRatePercent: { type: Number, default: 0, min: 0, max: 100 },
  instalments: { type: Number, required: true, min: 1, max: 120 },
  /** Total to recover, principal plus flat interest, rounded. */
  totalRepayable: { type: Number, required: true },
  instalmentAmount: { type: Number, required: true },
  /** First recovery period, "YYYY-MM". */
  startPeriod: { type: String, required: true },

  status: { type: String, enum: ["requested", "approved", "active", "closed", "rejected", "cancelled"], default: "requested", index: true },
  disbursedOn: { type: Date, default: null },
  disbursementReference: { type: String, default: "" },
  disbursedVia: { type: String, enum: ["payroll", "bank_transfer", "cash", "other", null], default: null },

  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  approvedAt: { type: Date, default: null },
  decisionComment: { type: String, default: "" },
  closedAt: { type: Date, default: null },
  closeReason: { type: String, default: "" },

  /** Extra one-off repayments outside payroll, netted from the outstanding figure. */
  manualRepayments: {
    type: [{ amount: Number, on: Date, reference: String, recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" } }],
    default: [],
  },
});

loanSchema.index({ organizationId: 1, number: 1 }, { unique: true });
loanSchema.index({ organizationId: 1, employeeId: 1, status: 1 });

const Loan = mongoose.model("Loan", loanSchema);

module.exports = { Loan };
