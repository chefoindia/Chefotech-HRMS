"use strict";

const express = require("express");
const { z } = require("zod");
const service = require("./expense.service");
const { authenticate } = require("../auth/authenticate");
const { requirePermission, requireAnyPermission } = require("../../core/rbac/authorize");
const { validate } = require("../../core/validation/validate");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { objectId, objectIdParam, dateString, listQuery, nullableObjectId } = require("../../core/validation/common");
const { ok, created, paged } = require("../../core/http/response");
const { AppError } = require("../../core/errors/AppError");

const router = express.Router();
router.use(authenticate());

const LineSchema = z.object({
  date: dateString(),
  category: z.string().trim().min(1).max(60),
  description: z.string().max(300).optional(),
  amount: z.number().min(0).max(100_000_000).optional().default(0),
  receiptFileId: nullableObjectId(),
  distanceKm: z.number().min(0).max(100_000).nullable().optional(),
});

const ClaimSchema = z.object({
  title: z.string().trim().min(2).max(120),
  purpose: z.string().max(1000).optional(),
  lines: z.array(LineSchema).min(1).max(100),
  advanceAmount: z.number().min(0).optional(),
  submit: z.boolean().optional(),
});

router.get("/policy", asyncHandler(async (_req, res) => ok(res, await service.policy())));
router.get("/summary", requireAnyPermission("expense.view", "expense.reimburse"), asyncHandler(async (_req, res) => ok(res, await service.summary())));

router.get(
  "/",
  requireAnyPermission("expense.view_own", "expense.view", "expense.approve"),
  validate({ query: listQuery({ scope: z.enum(["mine", "to_approve", "all"]).optional(), status: z.string().max(20).optional(), employeeId: objectId().optional() }) }),
  asyncHandler(async (req, res) => {
    const result = await service.list(req.query, req.auth);
    return paged(res, result.items, result);
  })
);

router.post(
  "/",
  requirePermission("expense.submit"),
  validate({ body: ClaimSchema }),
  asyncHandler(async (req, res) => {
    if (!req.auth.employeeId) throw AppError.badRequest("Your account is not linked to an employee record.");
    const { submit, ...data } = req.body;
    return created(res, await service.create(req.auth.employeeId, data, req, { submit: Boolean(submit) }));
  })
);

router.get("/:id", validate({ params: objectIdParam() }), asyncHandler(async (req, res) => ok(res, await service.get(req.params.id, req.auth))));

router.patch(
  "/:id",
  requirePermission("expense.submit"),
  validate({ params: objectIdParam(), body: ClaimSchema.partial().omit({ submit: true }) }),
  asyncHandler(async (req, res) => ok(res, await service.update(req.params.id, req.body, req.auth, req)))
);

router.post("/:id/submit", requirePermission("expense.submit"), validate({ params: objectIdParam() }), asyncHandler(async (req, res) => ok(res, await service.submitClaim(req.params.id, req, { auth: req.auth }))));

router.post(
  "/:id/decide",
  requireAnyPermission("expense.approve", "workflow.act"),
  validate({ params: objectIdParam(), body: z.object({ decision: z.enum(["approve", "reject"]), comment: z.string().max(500).optional(), approvedTotal: z.number().min(0).nullable().optional() }) }),
  asyncHandler(async (req, res) => ok(res, await service.decide(req.params.id, req.body, req)))
);

router.post(
  "/:id/reimburse",
  requirePermission("expense.reimburse"),
  validate({ params: objectIdParam(), body: z.object({ method: z.enum(["payroll", "bank_transfer", "cash", "other"]), reference: z.string().max(120).optional() }) }),
  asyncHandler(async (req, res) => ok(res, await service.reimburse(req.params.id, req.body, req)))
);

router.post("/:id/withdraw", validate({ params: objectIdParam() }), asyncHandler(async (req, res) => ok(res, await service.withdraw(req.params.id, req.auth, req))));

module.exports = router;
