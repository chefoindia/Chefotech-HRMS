"use strict";

const mongoose = require("mongoose");
const { createTenantSchema } = require("../../core/tenancy/baseSchema");

/**
 * A payroll input: one amount, for one employee, waiting for the next run.
 *
 * This is the single door through which everything outside payroll puts
 * money into a payslip — a loan instalment, an approved expense claim, an
 * encashed leave balance, an overtime payout, a one-off bonus typed in by
 * HR. Each module used to need its own hook into the run; now each just
 * files an input and the run picks it up.
 *
 * Idempotent by design: an input is `pending` until a run applies it, then
 * `applied` with the run and item it landed on. Re-processing that run
 * releases its inputs back to pending first, so nothing is charged twice.
 */
const payrollInputSchema = createTenantSchema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true, index: true },

  type: { type: String, enum: ["earning", "deduction"], required: true },
  label: { type: String, required: true, trim: true, maxlength: 120 },
  amount: { type: Number, required: true, min: 0 },
  reason: { type: String, default: "", maxlength: 500 },

  /**
   * The earliest period this may be applied in, as "YYYY-MM". Blank means
   * the next run to be processed. A loan schedule sets one per instalment.
   */
  periodKey: { type: String, default: null, index: true },

  /** Where it came from, so the module can find and reconcile its own inputs. */
  source: {
    type: { type: String, default: "manual", index: true }, // loan | expense | encashment | overtime | bonus | manual | request
    id: { type: mongoose.Schema.Types.ObjectId, default: null },
    reference: { type: String, default: "" },
  },

  status: { type: String, enum: ["pending", "applied", "cancelled"], default: "pending", index: true },
  appliedRunId: { type: mongoose.Schema.Types.ObjectId, ref: "PayrollRun", default: null },
  appliedItemId: { type: mongoose.Schema.Types.ObjectId, ref: "PayrollItem", default: null },
  appliedAt: { type: Date, default: null },
  cancelledAt: { type: Date, default: null },
  cancelReason: { type: String, default: "" },
});

payrollInputSchema.index({ organizationId: 1, employeeId: 1, status: 1, periodKey: 1 });
payrollInputSchema.index({ organizationId: 1, "source.type": 1, "source.id": 1 });

module.exports = mongoose.model("PayrollInput", payrollInputSchema);
