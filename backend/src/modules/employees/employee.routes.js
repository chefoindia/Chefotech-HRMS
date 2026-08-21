"use strict";

const express = require("express");
const service = require("./employee.service");
const customFields = require("./customField.service");
const importService = require("../imports/employeeImport.service");
const schemas = require("./employee.schema");
const { authenticate } = require("../auth/authenticate");
const { requirePermission, requireAnyPermission } = require("../../core/rbac/authorize");
const { validate } = require("../../core/validation/validate");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { uploadSingle } = require("../../core/http/upload");
const { objectIdParam } = require("../../core/validation/common");
const { ok, created, paged } = require("../../core/http/response");
const { heavyLimiter } = require("../../core/security/rateLimit");
const { AppError } = require("../../core/errors/AppError");
const audit = require("../../core/audit/audit.service");
const { z } = require("zod");

const router = express.Router();
router.use(authenticate());

// ── Custom field definitions ────────────────────────────────────────────────
// Declared before /:id so "custom-fields" is never read as an employee id.

router.get(
  "/custom-fields",
  requirePermission("employee.view"),
  asyncHandler(async (req, res) => ok(res, await customFields.list(req.query)))
);

router.post(
  "/custom-fields",
  requirePermission("employee.manage_custom_fields"),
  validate({ body: schemas.CustomFieldSchema }),
  asyncHandler(async (req, res) => created(res, await customFields.create(req.body, req)))
);

router.patch(
  "/custom-fields/:id",
  requirePermission("employee.manage_custom_fields"),
  validate({ params: objectIdParam(), body: schemas.CustomFieldSchema.partial() }),
  asyncHandler(async (req, res) => ok(res, await customFields.update(req.params.id, req.body, req)))
);

router.delete(
  "/custom-fields/:id",
  requirePermission("employee.manage_custom_fields"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => ok(res, await customFields.deactivate(req.params.id, req)))
);

// ── Import ──────────────────────────────────────────────────────────────────

router.get(
  "/import/template",
  requirePermission("employee.import"),
  asyncHandler(async (req, res) => {
    const { buffer, fileName } = await importService.buildTemplate();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    return res.send(buffer);
  })
);

/** Step 1: upload and parse. Nothing is written yet. */
router.post(
  "/import/analyse",
  requirePermission("employee.import"),
  heavyLimiter,
  uploadSingle("file"),
  asyncHandler(async (req, res) => ok(res, await importService.analyse(req.file)))
);

/** Step 2: validate the mapped rows and return a full error report. */
router.post(
  "/import/validate",
  requirePermission("employee.import"),
  heavyLimiter,
  asyncHandler(async (req, res) => ok(res, await importService.validateRows(req.body)))
);

/** Step 3: commit. Rows that fail are reported, never silently dropped. */
router.post(
  "/import/commit",
  requirePermission("employee.import"),
  heavyLimiter,
  asyncHandler(async (req, res) => ok(res, await importService.commit(req.body, req)))
);

// ── Statistics ──────────────────────────────────────────────────────────────

router.get(
  "/stats/headcount",
  requirePermission("employee.view"),
  asyncHandler(async (_req, res) => ok(res, await service.headcountStats()))
);

// ── Self service ────────────────────────────────────────────────────────────

router.get(
  "/me",
  requirePermission("profile.view_own"),
  asyncHandler(async (req, res) => {
    if (!req.auth.employeeId) {
      throw AppError.notFound("Your employee record");
    }
    return ok(res, await service.getById(req.auth.employeeId, req.auth));
  })
);

router.patch(
  "/me",
  requirePermission("profile.update_own"),
  validate({ body: schemas.SelfUpdateSchema }),
  asyncHandler(async (req, res) => {
    if (!req.auth.employeeId) throw AppError.notFound("Your employee record");
    return ok(res, await service.updateOwnProfile(req.auth.employeeId, req.body, req));
  })
);

router.get(
  "/me/team",
  requirePermission("profile.view_own"),
  asyncHandler(async (req, res) => {
    if (!req.auth.employeeId) return ok(res, []);
    return ok(res, await service.team(req.auth.employeeId, { depth: req.query.depth === "all" ? "all" : 1 }));
  })
);

// ── List and read ───────────────────────────────────────────────────────────

router.get(
  "/",
  requireAnyPermission("employee.view", "attendance.view_team", "leave.view_team", "profile.view_own"),
  validate({ query: schemas.ListEmployeesQuery }),
  asyncHandler(async (req, res) => {
    const result = await service.list(req.query, req.auth);
    return paged(res, result.items, result);
  })
);

router.get(
  "/:id",
  requireAnyPermission("employee.view", "profile.view_own"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => ok(res, await service.getById(req.params.id, req.auth)))
);

router.get(
  "/:id/team",
  requireAnyPermission("employee.view", "attendance.view_team"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => {
    await service.assertCanView(req.auth, req.params.id);
    return ok(res, await service.team(req.params.id, { depth: req.query.depth === "all" ? "all" : 1 }));
  })
);

router.get(
  "/:id/activity",
  requirePermission("employee.view"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => {
    await service.assertCanView(req.auth, req.params.id);
    return ok(res, await audit.forEntity("Employee", req.params.id, { limit: 100 }));
  })
);

// ── Mutations ───────────────────────────────────────────────────────────────

router.post(
  "/",
  requirePermission("employee.create"),
  validate({ body: schemas.CreateEmployeeSchema }),
  asyncHandler(async (req, res) => {
    const employee = await service.create(req.body, req);
    return created(res, await service.presentFor(employee, req.auth));
  })
);

router.patch(
  "/:id",
  requirePermission("employee.update"),
  validate({ params: objectIdParam(), body: schemas.UpdateEmployeeSchema }),
  asyncHandler(async (req, res) => ok(res, await service.update(req.params.id, req.body, req, req.auth)))
);

router.post(
  "/:id/status",
  requirePermission("employee.update"),
  validate({ params: objectIdParam(), body: schemas.ChangeStatusSchema }),
  asyncHandler(async (req, res) => {
    const employee = await service.changeStatus(req.params.id, req.body, req);
    return ok(res, await service.presentFor(employee, req.auth));
  })
);

router.post(
  "/:id/invite",
  requirePermission("user.invite"),
  validate({ params: objectIdParam(), body: schemas.InviteSchema }),
  asyncHandler(async (req, res) => ok(res, await service.invite(req.params.id, req.body, req)))
);

router.post(
  "/:id/avatar",
  requireAnyPermission("employee.update", "profile.update_own"),
  validate({ params: objectIdParam() }),
  uploadSingle("file", { maxBytes: 5 * 1024 * 1024 }),
  asyncHandler(async (req, res) => {
    const isSelf = String(req.auth.employeeId || "") === String(req.params.id);
    if (!isSelf && !req.auth.permissions.includes("employee.update")) {
      throw AppError.forbidden("You can only change your own profile photo.");
    }
    return ok(res, await service.setAvatar(req.params.id, req.file, req));
  })
);

router.delete(
  "/:id",
  requirePermission("employee.delete"),
  validate({
    params: objectIdParam(),
    body: z.object({ reason: z.string().max(500).optional() }).optional(),
  }),
  asyncHandler(async (req, res) =>
    // "Deleting" an employee archives them. Payroll and attendance history
    // must survive, and retention rules forbid a hard delete.
    ok(
      res,
      await service.changeStatus(
        req.params.id,
        { status: "inactive", reason: (req.body && req.body.reason) || "Archived by administrator" },
        req
      ).then((e) => ({ id: String(e._id), status: e.status }))
    )
  )
);

module.exports = router;
