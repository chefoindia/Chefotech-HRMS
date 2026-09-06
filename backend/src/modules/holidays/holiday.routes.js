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

const {
  CalendarSchema,
  HolidaySchema,
} = require("./holiday.schema");

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

/**
 * The holiday calendar as an .ics file, so it can be subscribed to from
 * Google Calendar, Outlook or a phone and stay in sync with what HR sets.
 */
router.get(
  "/me/calendar.ics",
  requirePermission("holiday.view"),
  asyncHandler(async (req, res) => {
    if (!req.auth.employeeId) throw AppError.notFound("Your employee record");
    const employee = await Employee.findById(req.auth.employeeId).lean();
    const year = Number(req.query.year) || new Date().getFullYear();
    const data = await service.forEmployee(employee, year);
    const all = [...(data.holidays || []), ...(data.optional || []).filter((h) => (data.selected || []).some((s) => String(s) === String(h._id || h.id)))];
    const escape = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
    const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ChefoTech HRMS//Holidays//EN", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${escape(`${req.auth.organization.name} holidays ${year}`)}`];
    for (const h of all) {
      const date = String(h.date).replace(/-/g, "");
      const next = new Date(`${h.date}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      lines.push("BEGIN:VEVENT", `UID:${h._id || h.id}@chefotech-hrms`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${date}`, `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, "")}`, `SUMMARY:${escape(h.name)}${h.isOptional ? " (optional)" : ""}`, h.description ? `DESCRIPTION:${escape(h.description)}` : null, "TRANSP:TRANSPARENT", "END:VEVENT");
    }
    lines.push("END:VCALENDAR");
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="holidays-${year}.ics"`);
    return res.send(lines.filter(Boolean).join("\r\n"));
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
