"use strict";

const { z } = require("zod");
const { objectId } = require("../../core/validation/common");

/**
 * The shapes the workflow endpoints accept.
 *
 * Lifted out of the routes file so the form registry can read them. That
 * registry derives every field's type, bounds and options from these
 * definitions rather than restating them, which only stays honest while
 * this file is the single place they are written down.
 */
const StepSchema = z.object({
  order: z.number().int().min(1).max(20),
  name: z.string().trim().min(1).max(60),
  approverType: z.enum([
    "reporting_manager",
    "manager_level",
    "department_head",
    "role",
    "permission",
    "specific_users",
    "requester",
  ]),
  managerLevel: z.number().int().min(1).max(10).optional(),
  roleIds: z.array(objectId()).optional(),
  permission: z.string().max(60).nullable().optional(),
  userIds: z.array(objectId()).optional(),
  mode: z.enum(["any", "all"]).optional(),
  // Parsing the expression is deliberately NOT done here. The real check runs
  // in workflow.routes.js `beforeCreate`, which reports which step failed and
  // why; this used to carry a copy of it that ended in `|| true`, so it could
  // never reject anything and only served to pull the formula engine into a
  // module that otherwise just describes shapes.
  condition: z.string().max(500).nullable().optional(),
  autoApproveAfterDays: z.number().int().min(0).max(365).optional(),
  escalateAfterDays: z.number().int().min(0).max(365).optional(),
  canReject: z.boolean().optional(),
  skipIfSelf: z.boolean().optional(),
});

const WorkflowSchema = z.object({
  name: z.string().trim().min(1).max(60),
  code: z.string().trim().min(1).max(20),
  description: z.string().max(300).optional(),
  entityType: z.enum([
    "leave_request",
    "attendance_correction",
    "expense_claim",
    "employee_onboarding",
    "salary_revision",
    "document_approval",
    "overtime",
    "asset_request",
  ]),
  steps: z.array(StepSchema).min(1, "Add at least one approval step").max(20),
  appliesTo: z
    .object({
      departmentIds: z.array(objectId()).optional(),
      locationIds: z.array(objectId()).optional(),
      employmentTypes: z.array(z.string()).optional(),
    })
    .optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  priority: z.number().int().min(1).max(1000).optional(),
});

module.exports = {
  StepSchema,
  WorkflowSchema,
};
