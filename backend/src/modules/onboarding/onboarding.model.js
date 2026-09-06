"use strict";

const mongoose = require("mongoose");
const { createTenantSchema } = require("../../core/tenancy/baseSchema");

/**
 * Onboarding checklists.
 *
 * A template is the list of things that must happen for a new joiner —
 * laptop ordered, email created, policies acknowledged, buddy assigned —
 * each owned by a role and due so many days from the joining date. Starting
 * one for an employee copies the list, resolves who owns each task, and
 * tracks it to done.
 */
const TASK_OWNERS = ["hr", "it", "finance", "admin", "manager", "employee"];

const templateTaskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, maxlength: 160 },
    description: { type: String, default: "", maxlength: 1000 },
    owner: { type: String, enum: TASK_OWNERS, default: "hr" },
    /** Days relative to the joining date; negative means before it. */
    dueOffsetDays: { type: Number, default: 0 },
    /** Link a task to something the platform can check, so it completes itself. */
    autoComplete: { type: String, enum: ["", "portal_invited", "documents_verified", "assets_assigned", "policies_acknowledged", "bank_details"], default: "" },
  },
  { _id: true }
);

const templateSchema = createTenantSchema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, default: "" },
  /** Applies automatically to joiners matching these; blank = everyone. */
  appliesTo: {
    departmentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Department" }],
    employmentTypes: [{ type: String }],
  },
  tasks: { type: [templateTaskSchema], default: [] },
  isDefault: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
});

const OnboardingTemplate = mongoose.model("OnboardingTemplate", templateSchema);

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String, default: "" },
    owner: { type: String, enum: TASK_OWNERS, default: "hr" },
    assigneeUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    dueOn: { type: String, default: null },
    status: { type: String, enum: ["pending", "done", "skipped"], default: "pending" },
    completedAt: { type: Date, default: null },
    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    note: { type: String, default: "" },
    autoComplete: { type: String, default: "" },
    reminderSentAt: { type: Date, default: null },
  },
  { _id: true }
);

const onboardingSchema = createTenantSchema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
  templateId: { type: mongoose.Schema.Types.ObjectId, ref: "OnboardingTemplate", default: null },
  templateName: { type: String, default: "" },
  joiningDate: { type: String, default: null },
  buddyEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },
  tasks: { type: [taskSchema], default: [] },
  status: { type: String, enum: ["in_progress", "completed", "cancelled"], default: "in_progress", index: true },
  completedAt: { type: Date, default: null },
  welcomeNote: { type: String, default: "", maxlength: 2000 },
});

onboardingSchema.index({ organizationId: 1, employeeId: 1 }, { unique: true, partialFilterExpression: { status: "in_progress" } });

const Onboarding = mongoose.model("Onboarding", onboardingSchema);

const DEFAULT_TEMPLATE = {
  name: "Standard joining checklist",
  description: "What every new joiner needs in their first fortnight.",
  isDefault: true,
  tasks: [
    { title: "Send offer and appointment letters", owner: "hr", dueOffsetDays: -7 },
    { title: "Collect ID, address and bank documents", owner: "employee", dueOffsetDays: -3, autoComplete: "documents_verified" },
    { title: "Invite to the employee portal", owner: "hr", dueOffsetDays: -2, autoComplete: "portal_invited" },
    { title: "Order laptop and set up accounts", owner: "it", dueOffsetDays: -2, autoComplete: "assets_assigned" },
    { title: "Add bank details for payroll", owner: "finance", dueOffsetDays: 0, autoComplete: "bank_details" },
    { title: "Issue ID and access cards", owner: "admin", dueOffsetDays: 0 },
    { title: "Day-one welcome and workplace tour", owner: "manager", dueOffsetDays: 0 },
    { title: "Read and acknowledge company policies", owner: "employee", dueOffsetDays: 3, autoComplete: "policies_acknowledged" },
    { title: "Introduce to the team and assign a buddy", owner: "manager", dueOffsetDays: 1 },
    { title: "30-day check-in", owner: "manager", dueOffsetDays: 30 },
  ],
};

module.exports = { OnboardingTemplate, Onboarding, TASK_OWNERS, DEFAULT_TEMPLATE };
