"use strict";

const express = require("express");
const { z } = require("zod");
const service = require("./rbac.service");
const { authenticate } = require("../auth/authenticate");
const { requirePermission } = require("../../core/rbac/authorize");
const { validate } = require("../../core/validation/validate");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { objectIdParam } = require("../../core/validation/common");
const { ok, created } = require("../../core/http/response");
const { PERMISSION_GROUPS, ALL_PERMISSIONS } = require("../../core/rbac/permissions");

const RoleSchema = z.object({
  name: z.string().trim().min(2).max(60),
  key: z.string().trim().max(40).optional(),
  description: z.string().max(300).optional(),
  permissions: z.array(z.string().max(60)).max(ALL_PERMISSIONS.length + 40),
  rank: z.number().int().min(1).max(100).optional(),
});

const router = express.Router();
router.use(authenticate());

router.get(
  "/",
  requirePermission("role.view"),
  asyncHandler(async (_req, res) => ok(res, await service.listRoles()))
);

/** The permission catalog, for the role editor. */
router.get(
  "/permissions",
  requirePermission("role.view"),
  asyncHandler(async (_req, res) => ok(res, PERMISSION_GROUPS))
);

router.get(
  "/:id",
  requirePermission("role.view"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => ok(res, await service.getRole(req.params.id)))
);

router.post(
  "/",
  requirePermission("role.manage"),
  validate({ body: RoleSchema }),
  asyncHandler(async (req, res) => created(res, await service.createRole(req.body, req)))
);

router.patch(
  "/:id",
  requirePermission("role.manage"),
  validate({ params: objectIdParam(), body: RoleSchema.partial() }),
  asyncHandler(async (req, res) => ok(res, await service.updateRole(req.params.id, req.body, req)))
);

router.delete(
  "/:id",
  requirePermission("role.manage"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => ok(res, await service.deleteRole(req.params.id, req)))
);

module.exports = router;
