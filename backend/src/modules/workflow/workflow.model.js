"use strict";

const mongoose = require("mongoose");
const { createTenantSchema, tenantUnique } = require("../../core/tenancy/baseSchema");

/**
 * The approval workflow engine's data model.
 *
 * A Workflow is a reusable definition: "leave requests go to the reporting
 * manager, then to HR if longer than five days". A WorkflowInstance is one
 * request travelling through it. Nothing in the leave, attendance or expense
 * modules contains an approval chain — they raise an instance and react to its
 * outcome, which is what lets a customer restructure approvals without a
 * release.
 */

const stepSchema = new mongoose.Schema(
  {
    order: { type: Number, required: true },
    name: { type: String, required: true },

    /** Who approves at this step. */
    approverType: {
      type: String,
      enum: [
        "reporting_manager",   // the requester's manager
        "manager_level",       // n levels up the reporting chain
        "department_head",
        "role",                // anyone holding a role
        "permission",          // anyone with a permission
        "specific_users",
        "requester",           // acknowledgement step
      ],
      required: true,
    },
    managerLevel: { type: Number, default: 1 },
    roleIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Role" }],
    permission: { type: String, default: null },
    userIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    /** All listed approvers must act, or any one of them is enough. */
    mode: { type: String, enum: ["any", "all"], default: "any" },

    /**
     * Skip this step unless the condition holds. Expressed as a formula
     * evaluated by the safe expression engine against the request's context,
     * e.g. "days > 5" or "amount >= 50000".
     */
    condition: { type: String, default: null },

    /** Approve automatically if nobody acts within this many days. 0 = never. */
    autoApproveAfterDays: { type: Number, default: 0 },
    /** Escalate to the next step's approvers after this many days. 0 = never. */
    escalateAfterDays: { type: Number, default: 0 },

    canReject: { type: Boolean, default: true },
    /** Skip if the resolved approver is the requester themselves. */
    skipIfSelf: { type: Boolean, default: true },
  },
  { _id: true }
);

const workflowSchema = createTenantSchema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true, uppercase: true },
  description: { type: String, default: "" },

  /** What this workflow governs. */
  entityType: {
    type: String,
    enum: [
      "leave_request",
      "attendance_correction",
      "expense_claim",
      "employee_onboarding",
      "salary_revision",
      "document_approval",
      "overtime",
      "asset_request",
      // Employee requests (modules/requests) — each may carry its own workflow.
      "wfh_request",
      "comp_off_request",
      "encashment_request",
      "shift_swap_request",
      "letter_request",
      "profile_change_request",
      "advance_request",
      "other_request",
      "loan_request",
      "resignation",
    ],
    required: true,
    index: true,
  },

  steps: { type: [stepSchema], default: [] },

  /** Narrow this workflow to part of the organization. Empty = everyone. */
  appliesTo: {
    departmentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Department" }],
    locationIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Location" }],
    employmentTypes: { type: [String], default: [] },
  },

  isDefault: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true, index: true },
  priority: { type: Number, default: 100 },
});

tenantUnique(workflowSchema, "code");
workflowSchema.index({ organizationId: 1, entityType: 1, isActive: 1, priority: 1 });

const Workflow = mongoose.model("Workflow", workflowSchema);

/** One request in flight. */
const workflowInstanceSchema = createTenantSchema({
  workflowId: { type: mongoose.Schema.Types.ObjectId, ref: "Workflow", required: true, index: true },
  entityType: { type: String, required: true, index: true },
  entityId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  entityLabel: { type: String, default: "" },

  requesterEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", index: true },
  requesterUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

  /** Values the step conditions are evaluated against. */
  context: { type: mongoose.Schema.Types.Mixed, default: {} },

  status: {
    type: String,
    enum: ["pending", "approved", "rejected", "cancelled", "expired"],
    default: "pending",
    index: true,
  },
  currentStepOrder: { type: Number, default: 1 },

  steps: {
    type: [
      {
        order: Number,
        name: String,
        status: {
          type: String,
          enum: ["waiting", "pending", "approved", "rejected", "skipped", "auto_approved", "escalated"],
          default: "waiting",
        },
        mode: String,
        approverUserIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
        startedAt: Date,
        completedAt: Date,
        dueAt: Date,
        skipReason: String,
        decisions: [
          {
            userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
            userName: String,
            decision: { type: String, enum: ["approved", "rejected"] },
            comment: String,
            decidedAt: Date,
            delegatedFrom: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
          },
        ],
      },
    ],
    default: [],
  },

  completedAt: { type: Date, default: null },
  outcome: { type: String, default: null },
  rejectionReason: { type: String, default: "" },
});

workflowInstanceSchema.index({ organizationId: 1, status: 1, "steps.approverUserIds": 1 });
workflowInstanceSchema.index({ organizationId: 1, entityType: 1, entityId: 1 });

const WorkflowInstance = mongoose.model("WorkflowInstance", workflowInstanceSchema);

/** Temporary reassignment of someone's approvals while they are away. */
const delegationSchema = createTenantSchema({
  fromUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  toUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  fromDate: { type: String, required: true },
  toDate: { type: String, required: true },
  entityTypes: { type: [String], default: [] }, // empty = everything
  reason: { type: String, default: "" },
  isActive: { type: Boolean, default: true },
});

delegationSchema.index({ organizationId: 1, fromUserId: 1, fromDate: 1, toDate: 1 });

const ApprovalDelegation = mongoose.model("ApprovalDelegation", delegationSchema);

module.exports = { Workflow, WorkflowInstance, ApprovalDelegation };
