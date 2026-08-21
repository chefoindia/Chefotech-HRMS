"use strict";

const express = require("express");
const { z } = require("zod");
const service = require("./leave.service");
const { LeaveType, LeavePolicy } = require("./leave.model");
const { createCrudService, createCrudController } = require("../../shared/crudFactory");
const { authenticate } = require("../auth/authenticate");
const { requirePermission, requireAnyPermission } = require("../../core/rbac/authorize");
const { validate } = require("../../core/validation/validate");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { objectId, objectIdParam, dateString, listQuery } = require("../../core/validation/common");
const { ok, created, paged } = require("../../core/http/response");
const { AppError } = require("../../core/errors/AppError");
const organizationService = require("../organizations/organization.service");

const LeaveTypeSchema = z.object({
  name: z.string().trim().min(1).max(60),
  code: z.string().trim().min(1).max(20),
  description: z.string().max(300).optional(),
  colour: z.string().max(9).optional(),
  isPaid: z.boolean().optional(),
  hasBalance: z.boolean().optional(),
  isCompOff: z.boolean().optional(),
  isSpecial: z.boolean().optional(),
  unit: z.enum(["day", "hour"]).optional(),
  allowHalfDay: z.boolean().optional(),
  allowHourly: z.boolean().optional(),
  requiresAttachment: z.boolean().optional(),
  attachmentRequiredAfterDays: z.number().int().min(0).max(60).optional(),
  eligibility: z
    .object({
      genders: z.array(z.string()).optional(),
      employmentTypes: z.array(z.string()).optional(),
      departmentIds: z.array(objectId()).optional(),
      locationIds: z.array(objectId()).optional(),
      minimumServiceMonths: z.number().int().min(0).max(120).optional(),
      availableDuringProbation: z.boolean().optional(),
      availableDuringNotice: z.boolean().optional(),
    })
    .optional(),
  isActive: z.boolean().optional(),
  order: z.number().int().optional(),
});

const RuleSchema = z.object({
  leaveTypeId: objectId(),
  allocation: z
    .object({
      mode: z.enum(["annual", "monthly", "quarterly", "accrual", "unlimited", "none"]).optional(),
      daysPerPeriod: z.number().min(0).max(365).optional(),
      accrualPerMonth: z.number().min(0).max(31).optional(),
      creditTiming: z.enum(["advance", "arrears"]).optional(),
      prorateOnJoining: z.boolean().optional(),
      prorateOnExit: z.boolean().optional(),
      rounding: z.enum(["none", "up", "down", "nearest_half", "nearest_whole"]).optional(),
      maximumBalance: z.number().min(0).max(999).optional(),
    })
    .optional(),
  carryForward: z
    .object({
      enabled: z.boolean().optional(),
      maximumDays: z.number().min(0).max(365).optional(),
      expiryMonths: z.number().int().min(0).max(24).optional(),
    })
    .optional(),
  encashment: z
    .object({
      enabled: z.boolean().optional(),
      maximumDays: z.number().min(0).max(365).optional(),
      minimumBalanceToRetain: z.number().min(0).max(365).optional(),
      onExitOnly: z.boolean().optional(),
    })
    .optional(),
  application: z
    .object({
      minimumDaysPerRequest: z.number().min(0).max(30).optional(),
      maximumDaysPerRequest: z.number().min(0).max(365).optional(),
      maximumRequestsPerYear: z.number().int().min(0).max(365).optional(),
      noticeDays: z.number().int().min(0).max(90).optional(),
      allowBackdated: z.boolean().optional(),
      backdatedLimitDays: z.number().int().min(0).max(365).optional(),
      allowNegativeBalance: z.boolean().optional(),
      maximumNegativeDays: z.number().min(0).max(60).optional(),
      maximumConcurrentInTeam: z.number().int().min(0).max(100).optional(),
    })
    .optional(),
  counting: z
    .object({
      holidays: z.enum(["exclude", "include", "sandwich"]).optional(),
      weeklyOffs: z.enum(["exclude", "include", "sandwich"]).optional(),
    })
    .optional(),
  approval: z
    .object({
      required: z.boolean().optional(),
      escalateAfterDays: z.number().int().min(0).max(365).optional(),
      workflowId: objectId().nullable().optional(),
      autoApprove: z.boolean().optional(),
    })
    .optional(),
});

const LeavePolicySchema = z.object({
  name: z.string().trim().min(1).max(60),
  code: z.string().trim().min(1).max(20),
  description: z.string().max(300).optional(),
  rules: z.array(RuleSchema).max(40).optional(),
  yearStartMonth: z.number().int().min(1).max(12).nullable().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const ApplySchema = z.object({
  leaveTypeId: objectId(),
  fromDate: dateString(),
  toDate: dateString(),
  fromPortion: z.enum(["full", "first_half", "second_half"]).optional(),
  toPortion: z.enum(["full", "first_half", "second_half"]).optional(),
  reason: z.string().trim().min(3, "Give a reason for this leave").max(500),
  contactDuringLeave: z.string().max(120).optional(),
  handoverToEmployeeId: objectId().nullable().optional(),
  attachmentFileId: objectId().nullable().optional(),
});

const typeService = createCrudService({
  model: LeaveType,
  entityType: "LeaveType",
  searchFields: ["name", "code"],
  defaultSort: "order",
  allowedSort: ["name", "order", "createdAt"],
});
const policyService = createCrudService({
  model: LeavePolicy,
  entityType: "LeavePolicy",
  searchFields: ["name", "code"],
  async afterCreate() {
    await organizationService.markStepCompleteIfPending("leave");
  },
});
const typeController = createCrudController(typeService);
const policyController = createCrudController(policyService);

const router = express.Router();
router.use(authenticate());

// ── Leave types ─────────────────────────────────────────────────────────────

router.get(
  "/types",
  requireAnyPermission("leave.view", "leave.apply"),
  validate({ query: listQuery() }),
  asyncHandler(typeController.list)
);
router.post(
  "/types",
  requirePermission("leave.manage_types"),
  validate({ body: LeaveTypeSchema }),
  asyncHandler(typeController.create)
);
router.patch(
  "/types/:id",
  requirePermission("leave.manage_types"),
  validate({ params: objectIdParam(), body: LeaveTypeSchema.partial() }),
  asyncHandler(typeController.update)
);
router.delete(
  "/types/:id",
  requirePermission("leave.manage_types"),
  validate({ params: objectIdParam() }),
  asyncHandler(typeController.remove)
);

// ── Leave policies ──────────────────────────────────────────────────────────

router.get(
  "/policies",
  requireAnyPermission("leave.manage_policies", "leave.view"),
  validate({ query: listQuery() }),
  asyncHandler(policyController.list)
);
router.get(
  "/policies/:id",
  requireAnyPermission("leave.manage_policies", "leave.view"),
  validate({ params: objectIdParam() }),
  asyncHandler(policyController.get)
);
router.post(
  "/policies",
  requirePermission("leave.manage_policies"),
  validate({ body: LeavePolicySchema }),
  asyncHandler(policyController.create)
);
router.patch(
  "/policies/:id",
  requirePermission("leave.manage_policies"),
  validate({ params: objectIdParam(), body: LeavePolicySchema.partial() }),
  asyncHandler(policyController.update)
);
router.delete(
  "/policies/:id",
  requirePermission("leave.manage_policies"),
  validate({ params: objectIdParam() }),
  asyncHandler(policyController.remove)
);

// ── Self service ────────────────────────────────────────────────────────────

router.get(
  "/me/balances",
  requireAnyPermission("leave.apply", "leave.view"),
  asyncHandler(async (req, res) => {
    if (!req.auth.employeeId) throw AppError.notFound("Your employee record");
    return ok(res, await service.balancesFor(req.auth.employeeId, req.query.asOf));
  })
);

router.post(
  "/me/preview",
  requirePermission("leave.apply"),
  validate({ body: ApplySchema.omit({ reason: true }).partial({ fromPortion: true, toPortion: true }) }),
  asyncHandler(async (req, res) => {
    if (!req.auth.employeeId) throw AppError.notFound("Your employee record");
    return ok(res, await service.preview(req.auth.employeeId, req.body));
  })
);

router.post(
  "/me/apply",
  requirePermission("leave.apply"),
  validate({ body: ApplySchema }),
  asyncHandler(async (req, res) => {
    if (!req.auth.employeeId) throw AppError.notFound("Your employee record");
    return created(res, await service.apply(req.auth.employeeId, req.body, req));
  })
);

// ── Balances ────────────────────────────────────────────────────────────────

router.get(
  "/balances/:employeeId",
  requireAnyPermission("leave.view", "leave.view_team"),
  validate({ params: objectIdParam("employeeId") }),
  asyncHandler(async (req, res) => {
    const employeeService = require("../employees/employee.service");
    await employeeService.assertCanView(req.auth, req.params.employeeId);
    return ok(res, await service.balancesFor(req.params.employeeId, req.query.asOf));
  })
);

router.post(
  "/balances/:employeeId/adjust",
  requirePermission("leave.adjust_balance"),
  validate({
    params: objectIdParam("employeeId"),
    body: z.object({
      leaveTypeId: objectId(),
      days: z.number().min(-365).max(365),
      note: z.string().trim().min(3, "Explain this adjustment").max(300),
      year: z.number().int().min(2000).max(2100).optional(),
    }),
  }),
  asyncHandler(async (req, res) =>
    ok(res, await service.adjustEmployeeBalance(req.params.employeeId, req.body, req))
  )
);

// ── Calendar ────────────────────────────────────────────────────────────────

router.get(
  "/calendar",
  requireAnyPermission("leave.view", "leave.view_team", "leave.apply"),
  validate({
    query: z.object({
      fromDate: dateString(),
      toDate: dateString(),
      departmentId: objectId().optional(),
    }),
  }),
  asyncHandler(async (req, res) => ok(res, await service.calendar(req.query, req.auth)))
);

// ── Requests ────────────────────────────────────────────────────────────────

router.get(
  "/requests",
  requireAnyPermission("leave.view", "leave.view_team", "leave.apply"),
  validate({
    query: listQuery({
      employeeId: objectId().optional(),
      departmentId: objectId().optional(),
      status: z.string().optional(),
      leaveTypeId: objectId().optional(),
      fromDate: dateString().optional(),
      toDate: dateString().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await service.listRequests(req.query, req.auth);
    return paged(res, result.items, result);
  })
);

router.get(
  "/requests/:id",
  requireAnyPermission("leave.view", "leave.view_team", "leave.apply"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => ok(res, await service.getRequest(req.params.id, req.auth)))
);

/** HR or a manager applying for someone else. */
router.post(
  "/requests",
  requirePermission("leave.apply_on_behalf"),
  validate({ body: ApplySchema.extend({ employeeId: objectId() }) }),
  asyncHandler(async (req, res) => {
    const { employeeId, ...data } = req.body;
    return created(res, await service.apply(employeeId, data, req, { onBehalf: true }));
  })
);

router.post(
  "/requests/:id/decide",
  requireAnyPermission("leave.approve", "leave.reject"),
  validate({
    params: objectIdParam(),
    body: z.object({
      decision: z.enum(["approve", "reject"]),
      comment: z.string().max(500).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    if (req.body.decision === "approve" && !req.auth.permissions.includes("leave.approve")) {
      throw AppError.forbidden("You do not have permission to approve leave.");
    }
    if (req.body.decision === "reject" && !req.auth.permissions.includes("leave.reject")) {
      throw AppError.forbidden("You do not have permission to reject leave.");
    }
    return ok(res, await service.decide(req.params.id, req.body, req));
  })
);

router.post(
  "/requests/:id/cancel",
  requireAnyPermission("leave.apply", "leave.cancel_any"),
  validate({
    params: objectIdParam(),
    body: z.object({ reason: z.string().max(300).optional() }),
  }),
  asyncHandler(async (req, res) => ok(res, await service.cancel(req.params.id, req.body, req, req.auth)))
);

module.exports = router;
