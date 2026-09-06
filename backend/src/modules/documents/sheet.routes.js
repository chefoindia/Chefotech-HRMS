"use strict";

const express = require("express");
const { z } = require("zod");
const service = require("./sheet.service");
const { SheetTemplateSchema } = require("./document.schema");
const { authenticate } = require("../auth/authenticate");
const { requirePermission, requireAnyPermission, hasPermission } = require("../../core/rbac/authorize");
const { validate } = require("../../core/validation/validate");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { objectId, objectIdParam, dateString } = require("../../core/validation/common");
const { ok, created } = require("../../core/http/response");
const { AppError } = require("../../core/errors/AppError");
const { heavyLimiter } = require("../../core/security/rateLimit");
const audit = require("../../core/audit/audit.service");

/**
 * Sheet templates — the designable spreadsheets.
 *
 * Designing one needs report.manage_definitions; running one needs
 * report.view plus whatever the data source itself requires (payroll.view
 * for a salary sheet), and exporting a file needs report.export. The
 * per-source check is inside the service so it cannot be forgotten by a
 * new route.
 */
const router = express.Router();
router.use(authenticate());

const FiltersSchema = z.object({
  fromDate: dateString().optional(),
  toDate: dateString().optional(),
  runId: objectId().optional(),
  departmentId: objectId().optional(),
  locationId: objectId().optional(),
  designationId: objectId().optional(),
  leaveTypeId: objectId().optional(),
  employeeIds: z.array(objectId()).max(2000).optional(),
  status: z.string().max(40).optional(),
  employmentType: z.string().max(40).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  includeInactive: z.boolean().optional(),
});

router.get(
  "/sources",
  requirePermission("report.view"),
  asyncHandler(async (req, res) => ok(res, await service.describeSources(req.auth)))
);

router.get(
  "/sources/:source/fields",
  requirePermission("report.view"),
  validate({ params: z.object({ source: z.string().max(40) }), query: z.object({ runId: objectId().optional(), fromDate: dateString().optional(), toDate: dateString().optional() }).passthrough() }),
  asyncHandler(async (req, res) => ok(res, await service.fieldsFor(req.params.source, req.query)))
);

// ── Schedules: sheets that email themselves ─────────────────────────────────

const schedules = require("./sheetSchedule.service");
const { PERIODS } = require("./sheetSchedule.model");

const ScheduleSchema = z.object({
  sheetId: objectId(),
  name: z.string().trim().min(1).max(120),
  frequency: z.enum(["daily", "weekly", "monthly"]),
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  dayOfMonth: z.number().int().min(1).max(28).optional(),
  hour: z.number().int().min(0).max(23).optional(),
  period: z.enum(PERIODS).optional(),
  format: z.enum(["xlsx", "csv", "pdf"]).optional(),
  filters: FiltersSchema.optional(),
  recipients: z.array(z.string().email()).min(1).max(20),
  subject: z.string().max(200).optional(),
  message: z.string().max(1000).optional(),
  isActive: z.boolean().optional(),
});

router.get(
  "/schedules",
  requirePermission("report.view"),
  validate({ query: z.object({ sheetId: objectId().optional() }).passthrough() }),
  asyncHandler(async (req, res) => ok(res, await schedules.list(req.query.sheetId)))
);
router.post(
  "/schedules",
  requirePermission("report.export"),
  validate({ body: ScheduleSchema }),
  asyncHandler(async (req, res) => created(res, await schedules.create(req.body, req)))
);
router.patch(
  "/schedules/:id",
  requirePermission("report.export"),
  validate({ params: objectIdParam(), body: ScheduleSchema.partial() }),
  asyncHandler(async (req, res) => ok(res, await schedules.update(req.params.id, req.body, req)))
);
router.delete("/schedules/:id", requirePermission("report.export"), validate({ params: objectIdParam() }), asyncHandler(async (req, res) => ok(res, await schedules.remove(req.params.id, req))));
router.post("/schedules/:id/run", requirePermission("report.export"), heavyLimiter, validate({ params: objectIdParam() }), asyncHandler(async (req, res) => ok(res, await schedules.run(req.params.id, { req }))));

router.get(
  "/",
  requirePermission("report.view"),
  asyncHandler(async (req, res) => ok(res, await service.list(req.query)))
);

router.post(
  "/seed-defaults",
  requirePermission("report.manage_definitions"),
  asyncHandler(async (_req, res) => ok(res, await service.seedDefaults()))
);

router.get(
  "/:id",
  requirePermission("report.view"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => ok(res, await service.get(req.params.id)))
);

router.post(
  "/",
  requirePermission("report.manage_definitions"),
  validate({ body: SheetTemplateSchema }),
  asyncHandler(async (req, res) => created(res, await service.create(req.body, req)))
);

router.patch(
  "/:id",
  requirePermission("report.manage_definitions"),
  validate({ params: objectIdParam(), body: SheetTemplateSchema.partial() }),
  asyncHandler(async (req, res) => ok(res, await service.update(req.params.id, req.body, req)))
);

router.delete(
  "/:id",
  requirePermission("report.manage_definitions"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => ok(res, await service.remove(req.params.id, req)))
);

/** Duplicate, so a customer can start from a built-in and keep the original. */
router.post(
  "/:id/duplicate",
  requirePermission("report.manage_definitions"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => {
    const source = await service.get(req.params.id);
    const { id, _id, isSystem, createdAt, updatedAt, createdBy, updatedBy, organizationId, deletedAt, deletedBy, ...rest } = source;
    const copy = await service.create(
      { ...rest, name: `${rest.name} (copy)`, code: `${rest.code}_COPY_${Date.now().toString(36).toUpperCase()}`.slice(0, 30) },
      req
    );
    return created(res, copy);
  })
);

/** The designer's live preview: the first rows, formatted. */
router.post(
  "/:id/preview",
  requirePermission("report.view"),
  validate({ params: objectIdParam(), body: z.object({ filters: FiltersSchema.optional(), limit: z.number().int().min(1).max(200).optional() }) }),
  asyncHandler(async (req, res) =>
    ok(res, await service.render(req.params.id, { filters: req.body.filters || {}, format: "json", limit: req.body.limit || 50 }, req.auth))
  )
);

/** The file. Rate limited like every export. */
router.post(
  "/:id/render",
  requirePermission("report.view"),
  heavyLimiter,
  validate({ params: objectIdParam(), body: z.object({ filters: FiltersSchema.optional(), format: z.enum(["xlsx", "csv", "pdf"]).optional() }) }),
  asyncHandler(async (req, res) => {
    if (!hasPermission(req, "report.export")) {
      throw AppError.forbidden("You do not have permission to export sheets.");
    }
    const format = req.body.format || "xlsx";
    const result = await service.render(req.params.id, { filters: req.body.filters || {}, format }, req.auth);

    await audit.record(
      { action: "sheet.exported", entityType: "SheetTemplate", entityId: req.params.id, after: { format, rows: result.rowCount, filters: req.body.filters || {} }, severity: "notice" },
      req
    );

    res.setHeader("Content-Type", result.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${result.fileName}"`);
    return res.send(result.buffer);
  })
);

module.exports = router;
