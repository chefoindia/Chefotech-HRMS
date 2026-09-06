"use strict";

const express = require("express");
const { z } = require("zod");
const service = require("./asset.service");
const { ASSET_CATEGORIES, ASSET_STATUSES, ASSET_CONDITIONS } = require("./asset.model");
const { authenticate } = require("../auth/authenticate");
const { requirePermission, requireAnyPermission } = require("../../core/rbac/authorize");
const { validate } = require("../../core/validation/validate");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { objectId, objectIdParam, listQuery, nullableDateString, nullableObjectId, optionalNumber } = require("../../core/validation/common");
const { ok, created, paged } = require("../../core/http/response");
const { AppError } = require("../../core/errors/AppError");

const router = express.Router();
router.use(authenticate());

const AssetSchema = z.object({
  tag: z.string().trim().max(40).optional(),
  name: z.string().trim().min(1).max(120),
  category: z.enum(ASSET_CATEGORIES).optional(),
  make: z.string().max(80).optional(),
  model: z.string().max(80).optional(),
  serialNumber: z.string().max(120).optional(),
  purchaseDate: nullableDateString(),
  purchaseCost: optionalNumber(),
  vendor: z.string().max(120).optional(),
  warrantyUntil: nullableDateString(),
  locationId: nullableObjectId(),
  notes: z.string().max(2000).optional(),
  status: z.enum(ASSET_STATUSES).optional(),
  condition: z.enum(ASSET_CONDITIONS).optional(),
});

router.get("/catalog", asyncHandler(async (_req, res) => ok(res, { categories: ASSET_CATEGORIES, statuses: ASSET_STATUSES, conditions: ASSET_CONDITIONS })));
router.get("/stats", requirePermission("asset.view"), asyncHandler(async (_req, res) => ok(res, await service.stats())));

/** What is with me. */
router.get(
  "/me",
  requireAnyPermission("asset.view_own", "asset.view"),
  asyncHandler(async (req, res) => {
    if (!req.auth.employeeId) return ok(res, []);
    return ok(res, await service.forEmployee(req.auth.employeeId));
  })
);

router.post(
  "/assignments/:id/acknowledge",
  requireAnyPermission("asset.view_own", "asset.view"),
  validate({ params: objectIdParam(), body: z.object({ name: z.string().max(120).optional() }).optional() }),
  asyncHandler(async (req, res) => ok(res, await service.acknowledge(req.params.id, req.auth, req.body || {})))
);

router.get("/employee/:employeeId", requirePermission("asset.view"), validate({ params: objectIdParam("employeeId") }), asyncHandler(async (req, res) => ok(res, await service.forEmployee(req.params.employeeId))));

router.get(
  "/",
  requirePermission("asset.view"),
  validate({ query: listQuery({ status: z.enum(ASSET_STATUSES).optional(), category: z.enum(ASSET_CATEGORIES).optional(), employeeId: objectId().optional(), locationId: objectId().optional(), warrantyExpiringDays: z.coerce.number().int().min(1).max(365).optional() }) }),
  asyncHandler(async (req, res) => {
    const result = await service.list(req.query);
    return paged(res, result.items, result);
  })
);

router.post("/", requirePermission("asset.manage"), validate({ body: AssetSchema }), asyncHandler(async (req, res) => created(res, await service.create(req.body, req))));
router.get("/:id", requirePermission("asset.view"), validate({ params: objectIdParam() }), asyncHandler(async (req, res) => ok(res, await service.get(req.params.id))));
router.patch("/:id", requirePermission("asset.manage"), validate({ params: objectIdParam(), body: AssetSchema.partial() }), asyncHandler(async (req, res) => ok(res, await service.update(req.params.id, req.body, req))));
router.delete("/:id", requirePermission("asset.manage"), validate({ params: objectIdParam() }), asyncHandler(async (req, res) => ok(res, await service.remove(req.params.id, req))));

router.post(
  "/:id/assign",
  requirePermission("asset.manage"),
  validate({ params: objectIdParam(), body: z.object({ employeeId: objectId(), assignedOn: nullableDateString(), expectedReturnOn: nullableDateString(), condition: z.enum(ASSET_CONDITIONS).optional(), notes: z.string().max(500).optional() }) }),
  asyncHandler(async (req, res) => ok(res, await service.assign(req.params.id, req.body, req)))
);

router.post(
  "/:id/return",
  requirePermission("asset.manage"),
  validate({ params: objectIdParam(), body: z.object({ returnedOn: nullableDateString(), condition: z.enum(ASSET_CONDITIONS).optional(), notes: z.string().max(500).optional(), recoveryAmount: z.number().min(0).optional(), newStatus: z.enum(["available", "in_repair", "lost", "retired"]).optional() }) }),
  asyncHandler(async (req, res) => {
    if (req.body.recoveryAmount && !req.auth.permissions.includes("payroll.process")) {
      throw AppError.forbidden("Charging a recovery to payroll needs the payroll processing permission.");
    }
    return ok(res, await service.recordReturn(req.params.id, req.body, req));
  })
);

module.exports = router;
