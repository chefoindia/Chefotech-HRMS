"use strict";

const express = require("express");
const { z } = require("zod");
const Shift = require("./shift.model");
const WeeklyOffPolicy = require("./weeklyOffPolicy.model");
const ShiftPattern = require("./shiftPattern.model");
const service = require("./shift.service");
const { createCrudService, createCrudController } = require("../../shared/crudFactory");
const { authenticate } = require("../auth/authenticate");
const { requirePermission } = require("../../core/rbac/authorize");
const { validate } = require("../../core/validation/validate");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { objectId, objectIdParam, listQuery, dateString } = require("../../core/validation/common");
const { ok } = require("../../core/http/response");
const { AppError } = require("../../core/errors/AppError");
const organizationService = require("../organizations/organization.service");

const {
  ShiftSchema,
  WeeklyOffSchema,
  PatternSchema,
  AssignSchema,
} = require("./shift.schema");

const shiftService = createCrudService({
  model: Shift,
  entityType: "Shift",
  searchFields: ["name", "code"],
  defaultSort: "startTime",
  allowedSort: ["name", "code", "startTime", "createdAt"],
  async afterCreate() {
    await organizationService.markStepCompleteIfPending("shifts");
  },
  async beforeDelete(doc) {
    const Employee = require("../employees/employee.model");
    const inUse = await Employee.countDocuments({
      "employment.shiftId": doc._id,
      status: { $in: ["active", "on_leave", "notice_period"] },
    });
    if (inUse) {
      throw AppError.conflict(
        `${inUse} active ${inUse === 1 ? "employee is" : "employees are"} on this shift. Move them first.`
      );
    }
  },
});

const weeklyOffService = createCrudService({
  model: WeeklyOffPolicy,
  entityType: "WeeklyOffPolicy",
  searchFields: ["name", "code"],
  async afterCreate() {
    await organizationService.markStepCompleteIfPending("workweek");
  },
});

const patternService = createCrudService({
  model: ShiftPattern,
  entityType: "ShiftPattern",
  searchFields: ["name", "code"],
  async beforeDelete(doc) {
    const Employee = require("../employees/employee.model");
    const inUse = await Employee.countDocuments({
      "employment.shiftPatternId": doc._id,
      status: { $in: ["active", "on_leave", "notice_period"] },
    });
    if (inUse) {
      throw AppError.conflict(
        `${inUse} active ${inUse === 1 ? "employee is" : "employees are"} on this pattern. Move them first.`
      );
    }
  },
});

const shiftController = createCrudController(shiftService);
const weeklyOffController = createCrudController(weeklyOffService);
const patternController = createCrudController(patternService);

const router = express.Router();
router.use(authenticate());

// ── Shift patterns (before /:id, or "/patterns" is read as an id) ───────────

router.get(
  "/patterns",
  requirePermission("shift.view"),
  validate({ query: listQuery() }),
  asyncHandler(patternController.list)
);
router.get(
  "/patterns/:id",
  requirePermission("shift.view"),
  validate({ params: objectIdParam() }),
  asyncHandler(patternController.get)
);
router.post(
  "/patterns",
  requirePermission("shift.manage"),
  validate({ body: PatternSchema }),
  asyncHandler(patternController.create)
);
router.patch(
  "/patterns/:id",
  requirePermission("shift.manage"),
  validate({ params: objectIdParam(), body: PatternSchema.partial() }),
  asyncHandler(patternController.update)
);
router.delete(
  "/patterns/:id",
  requirePermission("shift.manage"),
  validate({ params: objectIdParam() }),
  asyncHandler(patternController.remove)
);

/**
 * What a pattern actually produces over a date range.
 *
 * A rotation is genuinely hard to picture from its configuration — "three on,
 * three off, anchored to the 24th" tells you nothing about which shift a
 * given Thursday lands on. This resolves real dates so the editor can show a
 * calendar preview before anyone is rostered onto it.
 */
router.get(
  "/patterns/:id/preview",
  requirePermission("shift.view"),
  validate({
    params: objectIdParam(),
    query: z.object({ fromDate: dateString(), toDate: dateString() }),
  }),
  asyncHandler(async (req, res) => {
    const pattern = await ShiftPattern.findById(req.params.id).lean();
    if (!pattern) throw AppError.notFound("Shift pattern");

    const shifts = await Shift.find({}).select("name code startTime endTime colour").lean();
    const byId = Object.fromEntries(shifts.map((s) => [String(s._id), s]));
    const { eachDate } = require("../../shared/datetime");

    const days = eachDate(req.query.fromDate, req.query.toDate, 92).map((date) => {
      const outcome = service.evaluatePattern(pattern, date);
      if (!outcome) return { date, shift: null, isOff: false, uncovered: true };
      return {
        date,
        isOff: outcome.isOff,
        uncovered: false,
        shift: outcome.shiftId ? byId[outcome.shiftId] || null : null,
      };
    });

    return ok(res, { pattern: { id: String(pattern._id), name: pattern.name, type: pattern.type }, days });
  })
);

// ── Weekly off policies (before /:id) ───────────────────────────────────────

router.get(
  "/weekly-off",
  requirePermission("shift.view"),
  validate({ query: listQuery() }),
  asyncHandler(weeklyOffController.list)
);
router.post(
  "/weekly-off",
  requirePermission("shift.manage"),
  validate({ body: WeeklyOffSchema }),
  asyncHandler(weeklyOffController.create)
);
router.patch(
  "/weekly-off/:id",
  requirePermission("shift.manage"),
  validate({ params: objectIdParam(), body: WeeklyOffSchema.partial() }),
  asyncHandler(weeklyOffController.update)
);
router.delete(
  "/weekly-off/:id",
  requirePermission("shift.manage"),
  validate({ params: objectIdParam() }),
  asyncHandler(weeklyOffController.remove)
);

// ── Roster and assignment ───────────────────────────────────────────────────

router.get(
  "/roster",
  requirePermission("shift.view"),
  validate({
    query: z.object({
      fromDate: dateString(),
      toDate: dateString(),
      departmentId: objectId().optional(),
    }),
  }),
  asyncHandler(async (req, res) => ok(res, await service.roster(req.query)))
);

router.post(
  "/assign",
  requirePermission("shift.assign"),
  validate({ body: AssignSchema }),
  asyncHandler(async (req, res) => ok(res, await service.assign(req.body, req)))
);

// ── Shifts ──────────────────────────────────────────────────────────────────

router.get(
  "/",
  requirePermission("shift.view"),
  validate({ query: listQuery() }),
  asyncHandler(shiftController.list)
);
router.get(
  "/:id",
  requirePermission("shift.view"),
  validate({ params: objectIdParam() }),
  asyncHandler(shiftController.get)
);
router.post(
  "/",
  requirePermission("shift.manage"),
  validate({ body: ShiftSchema }),
  asyncHandler(shiftController.create)
);
router.patch(
  "/:id",
  requirePermission("shift.manage"),
  validate({ params: objectIdParam(), body: ShiftSchema.partial() }),
  asyncHandler(shiftController.update)
);
router.delete(
  "/:id",
  requirePermission("shift.manage"),
  validate({ params: objectIdParam() }),
  asyncHandler(shiftController.remove)
);

module.exports = router;
