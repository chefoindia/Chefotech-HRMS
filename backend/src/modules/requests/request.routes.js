"use strict";

const express = require("express");
const { z } = require("zod");
const service = require("./request.service");
const { REQUEST_TYPES } = require("./request.model");
const { describe } = require("./request.types");
const { authenticate } = require("../auth/authenticate");
const { requirePermission, requireAnyPermission } = require("../../core/rbac/authorize");
const { validate } = require("../../core/validation/validate");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { objectId, objectIdParam, listQuery } = require("../../core/validation/common");
const { ok, created, paged } = require("../../core/http/response");
const { AppError } = require("../../core/errors/AppError");

const router = express.Router();
router.use(authenticate());

/** The kinds of request this organization offers, for the "new request" screen. */
router.get("/types", asyncHandler(async (_req, res) => ok(res, describe())));

router.get(
  "/",
  validate({
    query: listQuery({
      scope: z.enum(["mine", "to_approve", "all"]).optional(),
      status: z.enum(["pending", "approved", "rejected", "cancelled", "completed"]).optional(),
      type: z.enum(REQUEST_TYPES).optional(),
      employeeId: objectId().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await service.list(req.query, req.auth);
    return paged(res, result.items, result);
  })
);

router.post(
  "/",
  requirePermission("request.submit"),
  validate({
    body: z.object({
      type: z.enum(REQUEST_TYPES),
      payload: z.record(z.any()).default({}),
      reason: z.string().max(1000).optional(),
      attachmentFileId: objectId().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    if (!req.auth.employeeId) throw AppError.badRequest("Your account is not linked to an employee record.");
    return created(res, await service.submit(req.auth.employeeId, req.body, req));
  })
);

/** HR raising a request on someone's behalf — a manager's WFH for a team member, say. */
router.post(
  "/on-behalf",
  requireAnyPermission("request.view", "request.approve"),
  validate({
    body: z.object({
      employeeId: objectId(),
      type: z.enum(REQUEST_TYPES),
      payload: z.record(z.any()).default({}),
      reason: z.string().max(1000).optional(),
    }),
  }),
  asyncHandler(async (req, res) => created(res, await service.submit(req.body.employeeId, req.body, req)))
);

router.get("/:id", validate({ params: objectIdParam() }), asyncHandler(async (req, res) => ok(res, await service.get(req.params.id, req.auth))));

router.post(
  "/:id/decide",
  validate({ params: objectIdParam(), body: z.object({ decision: z.enum(["approve", "reject"]), comment: z.string().max(500).optional() }) }),
  asyncHandler(async (req, res) => ok(res, await service.decide(req.params.id, req.body, req)))
);

router.post(
  "/:id/retry",
  requirePermission("request.approve"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => ok(res, await service.retryApply(req.params.id, req)))
);

router.post("/:id/cancel", validate({ params: objectIdParam() }), asyncHandler(async (req, res) => ok(res, await service.cancel(req.params.id, req.auth, req))));

module.exports = router;
