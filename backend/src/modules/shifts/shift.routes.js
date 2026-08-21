"use strict";

const express = require("express");
const { z } = require("zod");
const Shift = require("./shift.model");
const WeeklyOffPolicy = require("./weeklyOffPolicy.model");
const service = require("./shift.service");
const { createCrudService, createCrudController } = require("../../shared/crudFactory");
const { authenticate } = require("../auth/authenticate");
const { requirePermission } = require("../../core/rbac/authorize");
const { validate } = require("../../core/validation/validate");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { objectId, objectIdParam, listQuery, timeString, dateString } = require("../../core/validation/common");
const { ok } = require("../../core/http/response");
const { AppError } = require("../../core/errors/AppError");
const organizationService = require("../organizations/organization.service");

const ShiftSchema = z.object({
  name: z.string().trim().min(1).max(60),
  code: z.string().trim().min(1).max(20),
  description: z.string().max(300).optional(),
  type: z.enum(["fixed", "flexible", "rotational"]).optional(),
  startTime: timeString(),
  endTime: timeString(),
  breakMinutes: z.number().int().min(0).max(480).optional(),
  isBreakPaid: z.boolean().optional(),
  flexibleMinimumMinutes: z.number().int().min(60).max(1440).optional(),
  coreStartTime: timeString().nullable().optional(),
  coreEndTime: timeString().nullable().optional(),
  colour: z.string().max(9).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const WeeklyOffSchema = z.object({
  name: z.string().trim().min(1).max(60),
  code: z.string().trim().min(1).max(20),
  description: z.string().max(300).optional(),
  days: z
    .array(
      z.object({
        day: z.number().int().min(0).max(6),
        type: z.enum(["working", "off", "half_day", "alternate"]),
        offOccurrences: z.array(z.number().int().min(1).max(5)).optional(),
        halfDaySession: z.enum(["first", "second"]).optional(),
      })
    )
    .length(7, "Provide a rule for all seven days"),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const AssignSchema = z.object({
  employeeIds: z.array(objectId()).min(1).max(500),
  shiftId: objectId(),
  fromDate: dateString(),
  toDate: dateString(),
  reason: z.string().max(200).optional(),
});

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

const shiftController = createCrudController(shiftService);
const weeklyOffController = createCrudController(weeklyOffService);

const router = express.Router();
router.use(authenticate());

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
