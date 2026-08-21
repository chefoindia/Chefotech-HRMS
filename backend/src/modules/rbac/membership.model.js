"use strict";

const mongoose = require("mongoose");
const { createTenantSchema, tenantUnique } = require("../../core/tenancy/baseSchema");

/**
 * The join between a user and an organization: this is where access actually
 * lives. Delete the membership and the person keeps their login but loses the
 * organization entirely — which is exactly what offboarding should do.
 */
const membershipSchema = createTenantSchema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

  /** Links the login to the HR record. Null for people who are not employees. */
  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Employee",
    default: null,
    index: true,
  },

  roleIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Role" }],

  /**
   * Denormalised union of every role's permissions.
   *
   * Recomputed whenever roles change (see rbac.service.recomputeMembership).
   * The duplication is deliberate: authorising a request is the single hottest
   * read in the system and this turns it into one indexed lookup instead of a
   * membership → roles join on every call.
   */
  permissions: { type: [String], default: [] },

  status: {
    type: String,
    enum: ["invited", "active", "suspended", "removed"],
    default: "invited",
    index: true,
  },

  invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  invitedAt: { type: Date, default: null },
  joinedAt: { type: Date, default: null },
  lastActiveAt: { type: Date, default: null },

  /** Reporting line used by every "my team" scope in the platform. */
  isManager: { type: Boolean, default: false },
});

tenantUnique(membershipSchema, "userId");
membershipSchema.index({ organizationId: 1, status: 1 });
membershipSchema.index({ organizationId: 1, permissions: 1 });

module.exports = mongoose.model("Membership", membershipSchema);
