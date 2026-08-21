"use strict";

const express = require("express");
const { z } = require("zod");
const settings = require("../../core/settings/settings.service");
const registry = require("../../core/settings/settingsRegistry");
const { authenticate } = require("../auth/authenticate");
const { requirePermission, hasPermission } = require("../../core/rbac/authorize");
const { validate } = require("../../core/validation/validate");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { ok } = require("../../core/http/response");
const { AppError } = require("../../core/errors/AppError");
const { PERMISSION_GROUPS } = require("../../core/rbac/permissions");

const router = express.Router();
router.use(authenticate());

/**
 * Settings are grouped, and each group declares the permission needed to
 * change it. A user with settings.manage but not settings.manage_security can
 * read every group and write all but one — and the API is what enforces that,
 * not the tab visibility in the UI.
 */

router.get(
  "/",
  requirePermission("settings.view"),
  asyncHandler(async (req, res) => {
    const described = await settings.describe(req.query.group);
    return ok(res, {
      ...described,
      groups: described.groups.map((g) => ({
        ...g,
        canEdit: hasPermission(req, g.permission),
      })),
    });
  })
);

router.get(
  "/permissions",
  requirePermission("role.view"),
  asyncHandler(async (_req, res) => ok(res, PERMISSION_GROUPS))
);

router.get(
  "/:key",
  requirePermission("settings.view"),
  validate({ params: z.object({ key: z.string().max(80) }) }),
  asyncHandler(async (req, res) => {
    const definition = registry.definitionOf(req.params.key);
    if (!definition) throw AppError.notFound("Setting");
    return ok(res, { key: definition.key, value: await settings.get(definition.key), definition });
  })
);

router.patch(
  "/",
  requirePermission("settings.view"),
  validate({ body: z.record(z.any()) }),
  asyncHandler(async (req, res) => {
    // Each key is checked against its own group's permission, so one request
    // cannot smuggle a security change in behind an attendance change.
    for (const key of Object.keys(req.body)) {
      const definition = registry.definitionOf(key);
      if (!definition) throw AppError.badRequest(`Unknown setting '${key}'`);
      const group = registry.SETTING_GROUPS.find((g) => g.key === definition.group);
      const required = (group && group.permission) || "settings.manage";
      if (!hasPermission(req, required)) {
        throw AppError.forbidden(`You do not have permission to change ${definition.label}.`);
      }
    }

    const updated = await settings.setMany(req.body, { req, actorName: req.auth.name });
    return ok(res, updated);
  })
);

module.exports = router;
