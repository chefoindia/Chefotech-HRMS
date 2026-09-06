"use strict";

const mongoose = require("mongoose");
const { createTenantSchema } = require("../../core/tenancy/baseSchema");

/**
 * An employee request — the things people ask HR or their manager for that
 * are not leave: to work from home, a comp-off for a Sunday worked, to
 * encash leave, to swap a shift, a letter, a change to their own record.
 *
 * One collection rather than seven: they share a lifecycle (submitted →
 * decided → applied), an approval path, a notification pair and a screen.
 * What differs per type is the payload and what happens on approval, and
 * that lives in request.types.js.
 */
const REQUEST_TYPES = ["wfh", "comp_off", "encashment", "shift_swap", "letter", "profile_change", "advance", "other"];

const requestSchema = createTenantSchema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
  type: { type: String, enum: REQUEST_TYPES, required: true, index: true },

  /** Type-specific fields, validated by the type's schema before they get here. */
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  reason: { type: String, default: "", maxlength: 1000 },
  attachmentFileId: { type: mongoose.Schema.Types.ObjectId, ref: "StoredFile", default: null },

  /** A one-line summary for lists and notifications: "WFH 12–13 Mar". */
  summary: { type: String, default: "" },

  status: {
    type: String,
    enum: ["pending", "approved", "rejected", "cancelled", "completed"],
    default: "pending",
    index: true,
  },

  /** Who may decide, resolved at submission: the manager, or anyone with the approve permission. */
  approverUserIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  workflowInstanceId: { type: mongoose.Schema.Types.ObjectId, ref: "WorkflowInstance", default: null },

  decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  decidedByName: { type: String, default: "" },
  decidedAt: { type: Date, default: null },
  decisionComment: { type: String, default: "" },

  /** What approval did: the balance credited, the record changed, the document generated. */
  effect: { type: mongoose.Schema.Types.Mixed, default: null },
  completedAt: { type: Date, default: null },
  cancelledAt: { type: Date, default: null },
});

requestSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
requestSchema.index({ organizationId: 1, employeeId: 1, createdAt: -1 });
requestSchema.index({ organizationId: 1, approverUserIds: 1, status: 1 });

const EmployeeRequest = mongoose.model("EmployeeRequest", requestSchema);

module.exports = { EmployeeRequest, REQUEST_TYPES };
