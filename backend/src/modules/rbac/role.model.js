"use strict";

const mongoose = require("mongoose");
const { createTenantSchema, tenantUnique } = require("../../core/tenancy/baseSchema");

/**
 * A role inside one organization.
 *
 * Seeded from the system-role templates, then fully editable by the tenant.
 * The platform never branches on a role's name or key — only on the
 * permissions it carries — so renaming "HR Admin" to "People Ops" changes
 * nothing but a label.
 */
const roleSchema = createTenantSchema({
  key: { type: String, required: true, uppercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, default: "" },

  permissions: { type: [String], default: [], index: true },

  /**
   * The owner role. Guarded in two ways: its permissions cannot be reduced,
   * and the last user holding it cannot be stripped of it or deactivated.
   * Without that, a tenant can lock itself out of its own account.
   */
  isOwner: { type: Boolean, default: false },

  /** Seeded by the platform. Can be edited, cannot be deleted. */
  isSystem: { type: Boolean, default: false },

  /** Assigned to new employees who get portal access. */
  isDefault: { type: Boolean, default: false },

  /** Lower number = more senior. Used for "who may assign this role". */
  rank: { type: Number, default: 50 },

  memberCount: { type: Number, default: 0 },

  /**
   * The permission catalog version this role was last reconciled against.
   * See core/rbac/permissions.js — this is what lets a permission added in
   * a later release reach the system roles of organizations created earlier.
   */
  permissionsVersion: { type: Number, default: 1 },
});

tenantUnique(roleSchema, "key");
roleSchema.index({ organizationId: 1, name: 1 });

module.exports = mongoose.model("Role", roleSchema);
