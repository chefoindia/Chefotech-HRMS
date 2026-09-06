"use strict";

const express = require("express");
const { z } = require("zod");
const service = require("./loan.service");
const { authenticate } = require("../auth/authenticate");
const { requirePermission, requireAnyPermission } = require("../../core/rbac/authorize");
const { validate } = require("../../core/validation/validate");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { objectId, objectIdParam, listQuery, nullableDateString } = require("../../core/validation/common");
const { ok, created, paged } = require("../../core/http/response");
const { AppError } = require("../../core/errors/AppError");

const router = express.Router();
router.use(authenticate());

const LoanSchema = z.object({
  type: z.enum(["loan", "advance"]).optional(),
  purpose: z.string().max(500).optional(),
  principal: z.number().positive().max(100_000_000),
  interestRatePercent: z.number().min(0).max(100).optional(),
  instalments: z.number().int().min(1).max(120),
  startPeriod: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

router.get("/limits", asyncHandler(async (_req, res) => ok(res, await service.limits())));

/** A what-if for the request form. */
router.post(
  "/preview",
  validate({ body: LoanSchema.pick({ principal: true, interestRatePercent: true, instalments: true, startPeriod: true }) }),
  asyncHandler(async (req, res) => ok(res, service.schedule({ ...req.body, startPeriod: req.body.startPeriod || `${new Date().getFullYear()}-${String(new Date().getMonth() + 2).padStart(2, "0")}` })))
);

router.get(
  "/",
  requireAnyPermission("loan.view_own", "loan.manage", "loan.approve"),
  validate({ query: listQuery({ scope: z.enum(["mine", "all"]).optional(), status: z.string().max(20).optional(), employeeId: objectId().optional() }) }),
  asyncHandler(async (req, res) => {
    const result = await service.list(req.query, req.auth);
    return paged(res, result.items, result);
  })
);

/** An employee asking. */
router.post(
  "/",
  requirePermission("loan.view_own"),
  validate({ body: LoanSchema }),
  asyncHandler(async (req, res) => {
    if (!req.auth.employeeId) throw AppError.badRequest("Your account is not linked to an employee record.");
    return created(res, await service.create(req.auth.employeeId, req.body, req));
  })
);

/** HR recording a loan for someone, already approved. */
router.post(
  "/employee/:employeeId",
  requirePermission("loan.manage"),
  validate({ params: objectIdParam("employeeId"), body: LoanSchema }),
  asyncHandler(async (req, res) => created(res, await service.create(req.params.employeeId, req.body, req, { approve: true })))
);

router.get("/:id", validate({ params: objectIdParam() }), asyncHandler(async (req, res) => ok(res, await service.get(req.params.id, req.auth))));

router.post(
  "/:id/decide",
  requirePermission("loan.approve"),
  validate({ params: objectIdParam(), body: z.object({ decision: z.enum(["approve", "reject"]), comment: z.string().max(500).optional() }) }),
  asyncHandler(async (req, res) => ok(res, await service.decide(req.params.id, req.body, req)))
);

router.post(
  "/:id/disburse",
  requirePermission("loan.manage"),
  validate({ params: objectIdParam(), body: z.object({ via: z.enum(["payroll", "bank_transfer", "cash", "other"]), reference: z.string().max(120).optional(), disbursedOn: nullableDateString() }) }),
  asyncHandler(async (req, res) => ok(res, await service.disburse(req.params.id, req.body, req)))
);

router.post(
  "/:id/repayments",
  requirePermission("loan.manage"),
  validate({ params: objectIdParam(), body: z.object({ amount: z.number().positive(), on: nullableDateString(), reference: z.string().max(120).optional() }) }),
  asyncHandler(async (req, res) => ok(res, await service.recordRepayment(req.params.id, req.body, req)))
);

router.post(
  "/:id/close",
  requirePermission("loan.manage"),
  validate({ params: objectIdParam(), body: z.object({ reason: z.string().max(300).optional() }).optional() }),
  asyncHandler(async (req, res) => ok(res, await service.close(req.params.id, req.body || {}, req)))
);

module.exports = router;
