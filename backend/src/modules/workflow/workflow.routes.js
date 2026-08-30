"use strict";

const express = require("express");
const { z } = require("zod");
const service = require("./workflow.service");
const { Workflow, ApprovalDelegation } = require("./workflow.model");
const { createCrudService, createCrudController } = require("../../shared/crudFactory");
const { authenticate } = require("../auth/authenticate");
const { requirePermission } = require("../../core/rbac/authorize");
const { validate } = require("../../core/validation/validate");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { objectId, objectIdParam, dateString, listQuery } = require("../../core/validation/common");
const { ok, created, paged } = require("../../core/http/response");
const formula = require("../../core/rules/formula");

const {
  StepSchema,
  WorkflowSchema,
} = require("./workflow.schema");

const workflowService = createCrudService({
  model: Workflow,
  entityType: "Workflow",
  searchFields: ["name", "code"],
  defaultSort: "priority",
  allowedSort: ["name", "priority", "createdAt"],
  buildFilter: (query) => (query.entityType ? { entityType: query.entityType } : {}),
  beforeCreate(data) {
    // Reject an unparseable condition at save time rather than discovering it
    // when a request is stuck mid-approval.
    for (const step of data.steps || []) {
      if (!step.condition) continue;
      const check = formula.validateExpression(step.condition);
      if (!check.valid && check.error) {
        const { AppError } = require("../../core/errors/AppError");
        throw AppError.validation([
          { field: "steps.condition", message: `${step.name}: ${check.error}` },
        ]);
      }
    }
    return data;
  },
});
const workflowController = createCrudController(workflowService);

const router = express.Router();
router.use(authenticate());

// ── My approvals ────────────────────────────────────────────────────────────

router.get(
  "/pending",
  requirePermission("workflow.act"),
  validate({ query: listQuery({ entityType: z.string().optional() }) }),
  asyncHandler(async (req, res) => {
    const result = await service.pendingFor(req.auth.userId, req.query);
    return paged(res, result.items, result);
  })
);

router.post(
  "/instances/:id/decide",
  requirePermission("workflow.act"),
  validate({
    params: objectIdParam(),
    body: z.object({
      decision: z.enum(["approve", "reject"]),
      comment: z.string().max(500).optional(),
    }),
  }),
  asyncHandler(async (req, res) =>
    ok(res, await service.decide(req.params.id, req.body, req.auth.userId, req))
  )
);

router.get(
  "/instances/:id",
  requirePermission("workflow.view"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => {
    const { WorkflowInstance } = require("./workflow.model");
    const instance = await WorkflowInstance.findById(req.params.id)
      .populate([
        { path: "requesterEmployeeId", select: "employeeCode personal.firstName personal.lastName" },
        { path: "workflowId", select: "name code entityType" },
      ])
      .lean();
    if (!instance) {
      const { AppError } = require("../../core/errors/AppError");
      throw AppError.notFound("Approval");
    }
    return ok(res, { ...instance, url: service.urlFor(instance) });
  })
);

// ── Delegation ──────────────────────────────────────────────────────────────

router.get(
  "/delegations",
  requirePermission("workflow.delegate"),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await ApprovalDelegation.find({ fromUserId: req.auth.userId })
        .populate("toUserId", "firstName lastName email")
        .sort({ fromDate: -1 })
        .lean()
    )
  )
);

router.post(
  "/delegations",
  requirePermission("workflow.delegate"),
  validate({
    body: z.object({
      toUserId: objectId(),
      fromDate: dateString(),
      toDate: dateString(),
      entityTypes: z.array(z.string()).optional(),
      reason: z.string().max(300).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { AppError } = require("../../core/errors/AppError");
    if (String(req.body.toUserId) === String(req.auth.userId)) {
      throw AppError.badRequest("You cannot delegate approvals to yourself.");
    }
    const delegation = await ApprovalDelegation.create({
      ...req.body,
      fromUserId: req.auth.userId,
      createdBy: req.auth.userId,
    });
    return created(res, delegation);
  })
);

router.delete(
  "/delegations/:id",
  requirePermission("workflow.delegate"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => {
    await ApprovalDelegation.updateOne(
      { _id: req.params.id, fromUserId: req.auth.userId },
      { $set: { isActive: false } }
    );
    return ok(res, { id: req.params.id, cancelled: true });
  })
);

// ── Definitions ─────────────────────────────────────────────────────────────

router.get(
  "/",
  requirePermission("workflow.view"),
  validate({ query: listQuery({ entityType: z.string().optional() }) }),
  asyncHandler(workflowController.list)
);
router.get(
  "/:id",
  requirePermission("workflow.view"),
  validate({ params: objectIdParam() }),
  asyncHandler(workflowController.get)
);
router.post(
  "/",
  requirePermission("workflow.manage"),
  validate({ body: WorkflowSchema }),
  asyncHandler(workflowController.create)
);
router.patch(
  "/:id",
  requirePermission("workflow.manage"),
  validate({ params: objectIdParam(), body: WorkflowSchema.partial() }),
  asyncHandler(workflowController.update)
);
router.delete(
  "/:id",
  requirePermission("workflow.manage"),
  validate({ params: objectIdParam() }),
  asyncHandler(workflowController.remove)
);

module.exports = router;
