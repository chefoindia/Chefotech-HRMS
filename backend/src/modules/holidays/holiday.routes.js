"use strict";

const express = require("express");
const { z } = require("zod");
const service = require("./holiday.service");
const Employee = require("../employees/employee.model");
const { authenticate } = require("../auth/authenticate");
const { requirePermission, requireAnyPermission } = require("../../core/rbac/authorize");
const { validate } = require("../../core/validation/validate");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { objectId, objectIdParam, dateString } = require("../../core/validation/common");
const { ok, created } = require("../../core/http/response");
const { AppError } = require("../../core/errors/AppError");

const CalendarSchema = z.object({
  name: z.string().trim().min(1).max(60),
  code: z.string().trim().min(1).max(20),
  year: z.number().int().min(2000).max(2100),
  description: z.string().max(300).optional(),
  locationIds: z.array(objectId()).optional(),
  optionalHolidayQuota: z.number().int().min(0).max(20).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const HolidaySchema = z.object({
  calendarId: objectId(),
  name: z.string().trim().min(1).max(80),
  date: dateString(),
  type: z.enum(["public", "national", "regional", "company", "optional", "restricted"]).optional(),
  description: z.string().max(300).optional(),
  isHalfDay: z.enum(["", "first", "second"]).optional(),
  isOptional: z.boolean().optional(),
  isPaid: z.boolean().optional(),
  colour: z.string().max(9).optional(),
});

const router = express.Router();
router.use(authenticate());

// ── Calendars ───────────────────────────────────────────────────────────────

router.get(
  "/calendars",
  requirePermission("holiday.view"),
  asyncHandler(async (req, res) => ok(res, await service.listCalendars(req.query)))
);

router.post(
  "/calendars",
  requirePermission("holiday.manage"),
  validate({ body: CalendarSchema }),
  asyncHandler(async (req, res) => created(res, await service.createCalendar(req.body, req)))
);

router.patch(
  "/calendars/:id",
  requirePermission("holiday.manage"),
  validate({ params: objectIdParam(), body: CalendarSchema.partial() }),
  asyncHandler(async (req, res) => ok(res, await service.updateCalendar(req.params.id, req.body, req)))
);

router.delete(
  "/calendars/:id",
  requirePermission("holiday.manage"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => ok(res, await service.deleteCalendar(req.params.id, req)))
);

// ── My holidays ─────────────────────────────────────────────────────────────

router.get(
  "/me",
  requirePermission("holiday.view"),
  asyncHandler(async (req, res) => {
    if (!req.auth.employeeId) throw AppError.notFound("Your employee record");
    const employee = await Employee.findById(req.auth.employeeId).lean();
    const year = Number(req.query.year) || new Date().getFullYear();
    return ok(res, await service.forEmployee(employee, year));
  })
);

router.post(
  "/me/optional",
  requirePermission("holiday.view"),
  validate({
    body: z.object({
      year: z.number().int().min(2000).max(2100),
      holidayIds: z.array(objectId()).max(20),
    }),
  }),
  asyncHandler(async (req, res) => {
    if (!req.auth.employeeId) throw AppError.notFound("Your employee record");
    return ok(res, await service.selectOptional(req.auth.employeeId, req.body, req));
  })
);

// ── Holidays ────────────────────────────────────────────────────────────────

router.get(
  "/",
  requireAnyPermission("holiday.view", "profile.view_own"),
  asyncHandler(async (req, res) => ok(res, await service.listHolidays(req.query)))
);

router.post(
  "/",
  requirePermission("holiday.manage"),
  validate({ body: HolidaySchema }),
  asyncHandler(async (req, res) => created(res, await service.addHoliday(req.body, req)))
);

router.post(
  "/bulk",
  requirePermission("holiday.manage"),
  validate({
    body: z.object({
      calendarId: objectId(),
      holidays: z.array(HolidaySchema.omit({ calendarId: true })).min(1).max(100),
    }),
  }),
  asyncHandler(async (req, res) => ok(res, await service.addHolidaysBulk(req.body, req)))
);

router.delete(
  "/:id",
  requirePermission("holiday.manage"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => ok(res, await service.deleteHoliday(req.params.id, req)))
);

module.exports = router;
