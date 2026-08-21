"use strict";

const express = require("express");
const { z } = require("zod");
const service = require("./attendance.service");
const AttendancePolicy = require("./attendancePolicy.model");
const { createCrudService, createCrudController } = require("../../shared/crudFactory");
const { authenticate } = require("../auth/authenticate");
const { requirePermission, requireAnyPermission } = require("../../core/rbac/authorize");
const { validate } = require("../../core/validation/validate");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { objectId, objectIdParam, dateString, timeString, listQuery } = require("../../core/validation/common");
const { ok, created, paged, accepted } = require("../../core/http/response");
const { AppError } = require("../../core/errors/AppError");
const queue = require("../../core/jobs/queue");
const organizationService = require("../organizations/organization.service");

const PolicySchema = z.object({
  name: z.string().trim().min(1).max(60),
  code: z.string().trim().min(1).max(20),
  description: z.string().max(300).optional(),
  arrival: z
    .object({
      graceMinutes: z.number().int().min(0).max(240).optional(),
      lateAfterMinutes: z.number().int().min(0).max(480).optional(),
      halfDayAfterMinutes: z.number().int().min(0).max(720).optional(),
      absentAfterMinutes: z.number().int().min(0).max(720).optional(),
      earlyArrivalCountsAsOvertime: z.boolean().optional(),
    })
    .optional(),
  departure: z
    .object({
      graceMinutes: z.number().int().min(0).max(240).optional(),
      earlyLeavingAfterMinutes: z.number().int().min(0).max(480).optional(),
      halfDayBeforeMinutes: z.number().int().min(0).max(720).optional(),
    })
    .optional(),
  hours: z
    .object({
      basis: z.enum(["shift_based", "fixed_hours"]).optional(),
      fullDayMinutes: z.number().int().min(60).max(1440).optional(),
      halfDayMinutes: z.number().int().min(30).max(720).optional(),
      fullDayPercent: z.number().min(10).max(100).optional(),
      halfDayPercent: z.number().min(5).max(100).optional(),
      minimumMinutesForPresence: z.number().int().min(0).max(720).optional(),
    })
    .optional(),
  breaks: z
    .object({
      calculation: z.enum(["first_last", "paired"]).optional(),
      maxBreakMinutes: z.number().int().min(0).max(480).optional(),
      deductExcessBreak: z.boolean().optional(),
    })
    .optional(),
  lateMarks: z
    .object({
      enabled: z.boolean().optional(),
      countForDeduction: z.number().int().min(1).max(30).optional(),
      deductionType: z.enum(["half_day", "full_day", "leave"]).optional(),
      resetPeriod: z.enum(["monthly", "quarterly", "yearly"]).optional(),
    })
    .optional(),
  overtime: z
    .object({
      enabled: z.boolean().optional(),
      startsAfterMinutes: z.number().int().min(0).max(480).optional(),
      minimumMinutes: z.number().int().min(0).max(480).optional(),
      maximumMinutesPerDay: z.number().int().min(0).max(960).optional(),
      roundToMinutes: z.number().int().min(0).max(120).optional(),
      requiresApproval: z.boolean().optional(),
      normalDayRate: z.number().min(0).max(5).optional(),
      weeklyOffRate: z.number().min(0).max(5).optional(),
      holidayRate: z.number().min(0).max(5).optional(),
    })
    .optional(),
  weeklyOff: z
    .object({
      grantsCompOff: z.boolean().optional(),
      compOffFullDayMinutes: z.number().int().optional(),
      compOffHalfDayMinutes: z.number().int().optional(),
      countsAsOvertime: z.boolean().optional(),
    })
    .optional(),
  holiday: z
    .object({
      grantsCompOff: z.boolean().optional(),
      countsAsOvertime: z.boolean().optional(),
    })
    .optional(),
  missingPunch: z
    .object({
      treatAs: z.enum(["absent", "half_day", "present", "pending"]).optional(),
      autoCloseAtShiftEnd: z.boolean().optional(),
      notifyEmployee: z.boolean().optional(),
    })
    .optional(),
  regularization: z
    .object({
      enabled: z.boolean().optional(),
      windowDays: z.number().int().min(0).max(90).optional(),
      maxPerMonth: z.number().int().min(0).max(31).optional(),
      requiresApproval: z.boolean().optional(),
    })
    .optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const policyService = createCrudService({
  model: AttendancePolicy,
  entityType: "AttendancePolicy",
  searchFields: ["name", "code"],
  async afterCreate() {
    await organizationService.markStepCompleteIfPending("attendance");
  },
});
const policyController = createCrudController(policyService);

const router = express.Router();
router.use(authenticate());

// ── Policies ────────────────────────────────────────────────────────────────

router.get(
  "/policies",
  requireAnyPermission("settings.view", "attendance.view"),
  validate({ query: listQuery() }),
  asyncHandler(policyController.list)
);
router.get(
  "/policies/:id",
  requireAnyPermission("settings.view", "attendance.view"),
  validate({ params: objectIdParam() }),
  asyncHandler(policyController.get)
);
router.post(
  "/policies",
  requirePermission("settings.manage_policies"),
  validate({ body: PolicySchema }),
  asyncHandler(policyController.create)
);
router.patch(
  "/policies/:id",
  requirePermission("settings.manage_policies"),
  validate({ params: objectIdParam(), body: PolicySchema.partial() }),
  asyncHandler(policyController.update)
);
router.delete(
  "/policies/:id",
  requirePermission("settings.manage_policies"),
  validate({ params: objectIdParam() }),
  asyncHandler(policyController.remove)
);

// ── Self service ────────────────────────────────────────────────────────────

router.post(
  "/punch",
  requirePermission("attendance.punch"),
  validate({
    body: z.object({
      direction: z.enum(["in", "out"]).nullable().optional(),
      location: z
        .object({
          latitude: z.number().min(-90).max(90),
          longitude: z.number().min(-180).max(180),
          accuracy: z.number().optional(),
          address: z.string().max(200).optional(),
        })
        .optional(),
      note: z.string().max(200).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    if (!req.auth.employeeId) throw AppError.notFound("Your employee record");
    return created(res, await service.selfPunch(req.auth.employeeId, req.body, req));
  })
);

/**
 * My status today. The first call the mobile app makes on launch, so it is
 * kept deliberately small — a full month of calendar data to decide which
 * button to draw would be wasteful on a phone connection.
 */
router.get(
  "/me/today",
  requireAnyPermission("attendance.view_own", "profile.view_own", "attendance.punch"),
  asyncHandler(async (req, res) => {
    if (!req.auth.employeeId) throw AppError.notFound("Your employee record");
    return ok(res, await service.myToday(req.auth.employeeId));
  })
);

router.get(
  "/me",
  requireAnyPermission("attendance.view_own", "profile.view_own"),
  validate({
    query: z.object({
      year: z.coerce.number().int().min(2000).max(2100),
      month: z.coerce.number().int().min(1).max(12),
    }),
  }),
  asyncHandler(async (req, res) => {
    if (!req.auth.employeeId) throw AppError.notFound("Your employee record");
    return ok(
      res,
      await service.monthlyCalendar(
        req.auth.employeeId,
        { year: req.query.year, month: req.query.month },
        req.auth
      )
    );
  })
);

router.post(
  "/me/corrections",
  requirePermission("attendance.correct"),
  validate({
    body: z.object({
      date: dateString(),
      type: z.enum(["missing_punch", "wrong_punch", "forgot_to_punch", "on_duty", "work_from_home", "other"]),
      requested: z
        .object({
          checkIn: timeString().nullable().optional(),
          checkOut: timeString().nullable().optional(),
          status: z.string().nullable().optional(),
        })
        .optional(),
      reason: z.string().trim().min(5, "Explain why this correction is needed").max(500),
      attachmentFileId: objectId().nullable().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    if (!req.auth.employeeId) throw AppError.notFound("Your employee record");
    return created(res, await service.requestCorrection(req.auth.employeeId, req.body, req));
  })
);

// ── Dashboard ───────────────────────────────────────────────────────────────

router.get(
  "/today",
  requirePermission("attendance.view"),
  asyncHandler(async (_req, res) => ok(res, await service.todaySnapshot()))
);

// ── Corrections ─────────────────────────────────────────────────────────────

router.get(
  "/corrections",
  requireAnyPermission("attendance.approve", "attendance.view", "attendance.correct"),
  validate({ query: listQuery({ status: z.string().optional(), employeeId: objectId().optional() }) }),
  asyncHandler(async (req, res) => {
    const result = await service.listCorrections(req.query, req.auth);
    return paged(res, result.items, result);
  })
);

router.post(
  "/corrections/:id/review",
  requirePermission("attendance.approve"),
  validate({
    params: objectIdParam(),
    body: z.object({
      decision: z.enum(["approve", "reject"]),
      comment: z.string().max(500).optional(),
    }),
  }),
  asyncHandler(async (req, res) => ok(res, await service.reviewCorrection(req.params.id, req.body, req)))
);

// ── Locks ───────────────────────────────────────────────────────────────────

router.get(
  "/locks",
  requirePermission("attendance.view"),
  asyncHandler(async (_req, res) => ok(res, await service.listLocks()))
);

router.post(
  "/locks",
  requirePermission("attendance.lock"),
  validate({
    body: z.object({
      fromDate: dateString(),
      toDate: dateString(),
      reason: z.string().max(300).optional(),
    }),
  }),
  asyncHandler(async (req, res) => created(res, await service.lockPeriod(req.body, req)))
);

router.post(
  "/locks/:id/unlock",
  requirePermission("attendance.lock"),
  validate({
    params: objectIdParam(),
    body: z.object({ reason: z.string().trim().min(5, "Give a reason for unlocking").max(300) }),
  }),
  asyncHandler(async (req, res) => ok(res, await service.unlockPeriod(req.params.id, req.body, req)))
);

// ── Processing ──────────────────────────────────────────────────────────────

router.post(
  "/process",
  requirePermission("attendance.manage"),
  validate({
    body: z.object({
      fromDate: dateString(),
      toDate: dateString(),
      employeeIds: z.array(objectId()).max(1000).optional(),
      force: z.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const days = require("../../shared/datetime").daysBetween(req.body.fromDate, req.body.toDate);
    const employeeCount = (req.body.employeeIds && req.body.employeeIds.length) || 0;

    // Anything large enough to outlast an HTTP request goes to the queue.
    if (days > 7 || employeeCount > 50 || employeeCount === 0) {
      const job = await queue.enqueue("attendance.process-range", req.body, { priority: 5 });
      return accepted(res, {
        queued: true,
        jobId: String(job._id),
        message: "Attendance recalculation has been queued. It will finish in the background.",
      });
    }

    return ok(res, await service.processRange(req.body, req));
  })
);

// ── Overtime ────────────────────────────────────────────────────────────────

router.post(
  "/overtime/review",
  requirePermission("attendance.approve"),
  validate({
    body: z.object({
      recordIds: z.array(objectId()).min(1).max(500),
      decision: z.enum(["approve", "reject"]),
    }),
  }),
  asyncHandler(async (req, res) =>
    ok(res, await service.reviewOvertime(req.body.recordIds, req.body.decision, req))
  )
);

// ── Records ─────────────────────────────────────────────────────────────────

router.get(
  "/",
  requireAnyPermission("attendance.view", "attendance.view_team", "attendance.view_own"),
  validate({
    query: listQuery({
      employeeId: objectId().optional(),
      departmentId: objectId().optional(),
      locationId: objectId().optional(),
      fromDate: dateString().optional(),
      toDate: dateString().optional(),
      status: z.string().optional(),
      isLate: z.string().optional(),
      isMissingPunch: z.string().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await service.list(req.query, req.auth);
    return paged(res, result.items, result);
  })
);

router.get(
  "/employee/:employeeId",
  requireAnyPermission("attendance.view", "attendance.view_team", "attendance.view_own"),
  validate({
    params: objectIdParam("employeeId"),
    query: z.object({
      year: z.coerce.number().int().min(2000).max(2100),
      month: z.coerce.number().int().min(1).max(12),
    }),
  }),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await service.monthlyCalendar(
        req.params.employeeId,
        { year: req.query.year, month: req.query.month },
        req.auth
      )
    )
  )
);

router.post(
  "/employee/:employeeId/:date",
  requirePermission("attendance.manage"),
  validate({
    params: z.object({ employeeId: objectId(), date: dateString() }),
    body: z.object({
      status: z.enum([
        "present", "absent", "half_day", "weekly_off", "holiday",
        "leave", "on_duty", "work_from_home", "comp_off",
      ]),
      checkIn: timeString().nullable().optional(),
      checkOut: timeString().nullable().optional(),
      payableDays: z.number().min(0).max(2).optional(),
      reason: z.string().trim().min(3, "Give a reason for this change").max(300),
    }),
  }),
  asyncHandler(async (req, res) =>
    ok(res, await service.overrideDay(req.params.employeeId, req.params.date, req.body, req))
  )
);

module.exports = router;
