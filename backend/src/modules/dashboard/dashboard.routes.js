"use strict";

const express = require("express");
const service = require("./dashboard.service");
const { authenticate } = require("../auth/authenticate");
const { requirePermission } = require("../../core/rbac/authorize");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { ok } = require("../../core/http/response");

const router = express.Router();
router.use(authenticate());

/** HR / admin view. */
router.get(
  "/",
  requirePermission("dashboard.view"),
  asyncHandler(async (req, res) => {
    // Anyone can reach this route, but only someone with org-wide visibility
    // gets org-wide numbers; everyone else is redirected to their own view.
    if (!req.auth.permissions.includes("dashboard.view_org_wide") &&
        !req.auth.permissions.includes("employee.view")) {
      return ok(res, { scope: "self", ...(await service.myDashboard(req.auth)) });
    }
    return ok(res, { scope: "organization", ...(await service.hrDashboard(req.auth)) });
  })
);

router.get(
  "/me",
  asyncHandler(async (req, res) => ok(res, await service.myDashboard(req.auth)))
);

router.get(
  "/team",
  asyncHandler(async (req, res) => ok(res, await service.teamDashboard(req.auth)))
);

module.exports = router;
