"use strict";

const mongoose = require("mongoose");
const { tenantPlugin } = require("../../core/tenancy/tenantPlugin");

/**
 * "When this happens, tell these people."
 *
 * Until now every notification's audience was decided in code: leave.service
 * names the employee, workflow.service names the approver, and an
 * administrator who wanted the plant manager copied on every rejection had no
 * way to say so. This is that missing half — a tenant-owned table of rules,
 * each binding an event to an audience, a template and a set of channels.
 *
 * It is additive by design. A rule never removes a recipient the code already
 * chose, so switching one on cannot silently stop an employee hearing that
 * their own leave was approved. The worst a misconfigured rule can do is copy
 * somebody who did not need to know.
 *
 * `condition` is the same expression language the payroll components and
 * workflow steps use, evaluated against the notification's own data. That is
 * deliberate: an administrator who has already written "days > 5" on an
 * approval step should not have to learn a second syntax to write it here.
 */

const RECIPIENT_TYPES = [
  // Resolved from the event's own payload.
  "subject", // the person the event is about — whose leave, whose payslip
  "actor", // the person who caused it — who approved, who rejected
  "reporting_manager", // the subject's manager, resolved at send time
  "department_head", // the head of the subject's department
  // Resolved from the tenant's directory.
  "role", // everyone holding one of `roleIds`
  "user", // named platform users
  "employee", // named employees
  // Anything else — a shared inbox, an auditor, a payroll bureau.
  "email",
];

const RecipientSchema = new mongoose.Schema(
  {
    type: { type: String, enum: RECIPIENT_TYPES, required: true },
    roleIds: { type: [mongoose.Schema.Types.ObjectId], ref: "Role", default: undefined },
    userIds: { type: [mongoose.Schema.Types.ObjectId], ref: "User", default: undefined },
    employeeIds: { type: [mongoose.Schema.Types.ObjectId], ref: "Employee", default: undefined },
    /** For type "email" — an address outside the platform. */
    email: { type: String, default: null },
  },
  { _id: false }
);

const NotificationRuleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, default: "", maxlength: 300 },

    /**
     * The event this fires on, e.g. "leave.rejected". Matched against the
     * template registry's `event` field rather than a template key, because
     * several templates can describe the same event and an administrator
     * thinks in terms of what happened, not which message was used.
     */
    event: { type: String, required: true, index: true },

    /**
     * Which message to send. Null means "whatever template the code was
     * already going to use", which is the common case — the rule is there to
     * change the audience, not the wording.
     */
    templateKey: { type: String, default: null },

    /**
     * Optional gate. Empty means always. Evaluated against the notification's
     * data, so "days > 5" or "amount > 50000" both work.
     */
    condition: { type: String, default: null, maxlength: 500 },

    recipients: {
      type: [RecipientSchema],
      default: [],
      validate: {
        validator: (value) => Array.isArray(value) && value.length > 0,
        message: "A rule needs at least one recipient, or it does nothing.",
      },
    },

    /**
     * Null means "the channels the template already declares". Setting it is
     * how an administrator says "this one is important enough to email, not
     * just show in the bell".
     */
    channels: { type: [String], default: null },

    isActive: { type: Boolean, default: true },

    /**
     * Marks the rules seeded for a new organization. Kept so the defaults can
     * be told apart from what a customer wrote, and so re-seeding never
     * duplicates or overwrites their own work.
     */
    isSystemDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);

NotificationRuleSchema.plugin(tenantPlugin);

// The dispatcher's only query: active rules for one event in one tenant.
NotificationRuleSchema.index({ organizationId: 1, event: 1, isActive: 1 });

module.exports = mongoose.model("NotificationRule", NotificationRuleSchema);
module.exports.RECIPIENT_TYPES = RECIPIENT_TYPES;
