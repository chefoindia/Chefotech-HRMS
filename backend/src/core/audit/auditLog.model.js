"use strict";

const mongoose = require("mongoose");
const { createGlobalSchema } = require("../tenancy/baseSchema");

/**
 * Append-only audit trail.
 *
 * Deliberately NOT built with createTenantSchema: audit entries must be
 * writable from system contexts (jobs, super admin) and must never be soft
 * deleted or rewritten. organizationId is stored explicitly and every read
 * path filters on it by hand.
 */
const auditLogSchema = createGlobalSchema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Organization",
    index: true,
    default: null,
  },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  actorName: { type: String, default: null },
  actorEmail: { type: String, default: null },
  actorType: {
    type: String,
    enum: ["user", "system", "job", "integration", "platform"],
    default: "user",
  },

  action: { type: String, required: true, index: true }, // "leave.approved"
  entityType: { type: String, required: true, index: true }, // "LeaveRequest"
  entityId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
  entityLabel: { type: String, default: null }, // human anchor, e.g. "EMP0012 — Ravi"

  // Field-level diff. Only changed keys are stored, and sensitive values are
  // masked by the audit service before they get here.
  before: { type: mongoose.Schema.Types.Mixed, default: null },
  after: { type: mongoose.Schema.Types.Mixed, default: null },
  changedFields: { type: [String], default: [] },

  severity: {
    type: String,
    enum: ["info", "notice", "warning", "critical"],
    default: "info",
  },
  description: { type: String, default: null },

  ip: { type: String, default: null },
  userAgent: { type: String, default: null },
  requestId: { type: String, default: null },

  occurredAt: { type: Date, default: Date.now, index: true },
});

auditLogSchema.index({ organizationId: 1, occurredAt: -1 });
auditLogSchema.index({ organizationId: 1, entityType: 1, entityId: 1, occurredAt: -1 });
auditLogSchema.index({ organizationId: 1, actorId: 1, occurredAt: -1 });

/** Immutability is enforced here rather than trusted to callers. */
function blockMutation(next) {
  next(new Error("Audit log entries are immutable"));
}
auditLogSchema.pre("updateOne", blockMutation);
auditLogSchema.pre("updateMany", blockMutation);
auditLogSchema.pre("findOneAndUpdate", blockMutation);
auditLogSchema.pre("deleteOne", blockMutation);
auditLogSchema.pre("deleteMany", blockMutation);
auditLogSchema.pre("findOneAndDelete", blockMutation);

auditLogSchema.pre("save", function preventEdit(next) {
  if (!this.isNew) return next(new Error("Audit log entries are immutable"));
  return next();
});

module.exports = mongoose.model("AuditLog", auditLogSchema);
