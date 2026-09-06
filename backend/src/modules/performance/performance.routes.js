"use strict";

const express = require("express");
const { z } = require("zod");
const service = require("./performance.service");
const { GOAL_STATUSES, AUDIENCE_TYPES, DEFAULT_SECTIONS } = require("./performance.model");
const { authenticate } = require("../auth/authenticate");
const { requirePermission, requireAnyPermission } = require("../../core/rbac/authorize");
const { validate } = require("../../core/validation/validate");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { objectId, objectIdParam, nullableDateString, nullableObjectId, dateString } = require("../../core/validation/common");
const { ok, created } = require("../../core/http/response");

const router = express.Router();
router.use(authenticate());

const ANY = ["performance.view_own", "performance.review", "performance.manage"];

const AudienceSchema = z.object({
  type: z.enum(AUDIENCE_TYPES).default("all"),
  departmentId: nullableObjectId().optional(),
  locationId: nullableObjectId().optional(),
  employeeIds: z.array(objectId()).max(5000).optional(),
});

const GoalSchema = z.object({
  employeeId: objectId().optional(),
  cycleId: nullableObjectId().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  metric: z.string().max(200).optional(),
  target: z.string().max(120).optional(),
  weight: z.number().int().min(1).max(100).optional(),
  dueDate: nullableDateString().optional(),
  alignedToId: nullableObjectId().optional(),
});

const SectionSchema = z.object({
  key: z.string().trim().min(1).max(40).regex(/^[a-z0-9_]+$/, "Lowercase letters, digits and underscores."),
  title: z.string().trim().min(1).max(120),
  description: z.string().max(600).optional(),
  rated: z.boolean().optional(),
});

const CycleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  periodStart: dateString(),
  periodEnd: dateString(),
  audience: AudienceSchema.optional(),
  sections: z.array(SectionSchema).min(1).max(12).optional(),
  ratingScale: z.number().int().min(3).max(10).optional(),
  selfReviewRequired: z.boolean().optional(),
  selfDueAt: nullableDateString().optional(),
  managerDueAt: nullableDateString().optional(),
});

const RatingsSchema = z.object({
  ratings: z.record(z.string(), z.union([z.number(), z.string(), z.null()])).optional(),
  answers: z.record(z.string(), z.string().max(4000)).optional(),
});

router.get("/catalog", requireAnyPermission(ANY), asyncHandler(async (_req, res) => ok(res, { goalStatuses: GOAL_STATUSES, defaultSections: DEFAULT_SECTIONS })));

// ── Goals ────────────────────────────────────────────────────────────────────

router.get(
  "/goals",
  requireAnyPermission(ANY),
  validate({ query: z.object({ scope: z.enum(["mine", "team", "all"]).optional(), employeeId: objectId().optional(), status: z.enum(GOAL_STATUSES).optional(), cycleId: objectId().optional() }).passthrough() }),
  asyncHandler(async (req, res) => ok(res, await service.listGoals(req.query, req.auth)))
);
router.post("/goals", requireAnyPermission(ANY), validate({ body: GoalSchema }), asyncHandler(async (req, res) => created(res, await service.createGoal(req.body, req.auth, req))));
router.get("/goals/:id", requireAnyPermission(ANY), validate({ params: objectIdParam() }), asyncHandler(async (req, res) => ok(res, await service.getGoal(req.params.id, req.auth))));
router.patch(
  "/goals/:id",
  requireAnyPermission(ANY),
  validate({ params: objectIdParam(), body: GoalSchema.partial().extend({ status: z.enum(GOAL_STATUSES).optional() }) }),
  asyncHandler(async (req, res) => ok(res, await service.updateGoal(req.params.id, req.body, req.auth, req)))
);
router.post(
  "/goals/:id/progress",
  requireAnyPermission(ANY),
  validate({ params: objectIdParam(), body: z.object({ progress: z.number().int().min(0).max(100), note: z.string().max(1000).optional() }) }),
  asyncHandler(async (req, res) => ok(res, await service.updateProgress(req.params.id, req.body, req.auth, req)))
);
router.delete("/goals/:id", requireAnyPermission(ANY), validate({ params: objectIdParam() }), asyncHandler(async (req, res) => ok(res, await service.removeGoal(req.params.id, req.auth, req))));

// ── Cycles ───────────────────────────────────────────────────────────────────

router.get("/cycles", requireAnyPermission(["performance.review", "performance.manage"]), asyncHandler(async (_req, res) => ok(res, await service.listCycles())));
router.post("/cycles", requirePermission("performance.manage"), validate({ body: CycleSchema }), asyncHandler(async (req, res) => created(res, await service.createCycle(req.body, req))));
router.get("/cycles/:id", requirePermission("performance.manage"), validate({ params: objectIdParam() }), asyncHandler(async (req, res) => ok(res, await service.getCycle(req.params.id))));
router.patch("/cycles/:id", requirePermission("performance.manage"), validate({ params: objectIdParam(), body: CycleSchema.partial() }), asyncHandler(async (req, res) => ok(res, await service.updateCycle(req.params.id, req.body, req))));
router.post("/cycles/:id/start", requirePermission("performance.manage"), validate({ params: objectIdParam() }), asyncHandler(async (req, res) => ok(res, await service.startCycle(req.params.id, req))));
router.post("/cycles/:id/advance", requirePermission("performance.manage"), validate({ params: objectIdParam() }), asyncHandler(async (req, res) => ok(res, await service.advanceCycle(req.params.id, req))));
router.post("/cycles/:id/close", requirePermission("performance.manage"), validate({ params: objectIdParam() }), asyncHandler(async (req, res) => ok(res, await service.closeCycle(req.params.id, req))));
router.get("/cycles/:id/summary", requirePermission("performance.manage"), validate({ params: objectIdParam() }), asyncHandler(async (req, res) => ok(res, await service.cycleSummary(req.params.id))));

// ── Reviews ──────────────────────────────────────────────────────────────────

router.get("/reviews/me", requireAnyPermission(ANY), asyncHandler(async (req, res) => ok(res, await service.myReviews(req.auth))));
router.get("/reviews/to-review", requireAnyPermission(["performance.review", "performance.manage"]), asyncHandler(async (req, res) => ok(res, await service.toReview(req.auth))));
router.get("/reviews/:id", requireAnyPermission(ANY), validate({ params: objectIdParam() }), asyncHandler(async (req, res) => ok(res, await service.getReview(req.params.id, req.auth))));
router.post("/reviews/:id/self", requireAnyPermission(ANY), validate({ params: objectIdParam(), body: RatingsSchema }), asyncHandler(async (req, res) => ok(res, await service.submitSelf(req.params.id, req.body, req.auth, req))));
router.post(
  "/reviews/:id/manager",
  requireAnyPermission(["performance.review", "performance.manage"]),
  validate({ params: objectIdParam(), body: RatingsSchema.extend({ overallRating: z.number().int().min(1).max(10), summary: z.string().max(4000).optional() }) }),
  asyncHandler(async (req, res) => ok(res, await service.submitManager(req.params.id, req.body, req.auth, req)))
);
router.post("/reviews/:id/acknowledge", requireAnyPermission(ANY), validate({ params: objectIdParam(), body: z.object({ comment: z.string().max(2000).optional() }) }), asyncHandler(async (req, res) => ok(res, await service.acknowledge(req.params.id, req.body, req.auth, req))));
router.patch("/reviews/:id/reviewer", requirePermission("performance.manage"), validate({ params: objectIdParam(), body: z.object({ reviewerId: objectId() }) }), asyncHandler(async (req, res) => ok(res, await service.reassignReviewer(req.params.id, req.body.reviewerId, req))));

module.exports = router;
