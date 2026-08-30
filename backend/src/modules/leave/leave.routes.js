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

const {
  LeaveTypeSchema,
  RuleSchema,
  LeavePolicySchema,
  ApplySchema,
} = require("./leave.schema");

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
