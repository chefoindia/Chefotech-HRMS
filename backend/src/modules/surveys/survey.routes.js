"use strict";

const express = require("express");
const { z } = require("zod");
const service = require("./survey.service");
const { QUESTION_TYPES, AUDIENCE_TYPES, SURVEY_STATUSES } = require("./survey.model");
const { authenticate } = require("../auth/authenticate");
const { requirePermission } = require("../../core/rbac/authorize");
const { validate } = require("../../core/validation/validate");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { objectId, objectIdParam, nullableDateString, nullableObjectId } = require("../../core/validation/common");
const { ok, created } = require("../../core/http/response");

const router = express.Router();
router.use(authenticate());

const QuestionSchema = z.object({
  id: z.string().max(20).optional(),
  type: z.enum(QUESTION_TYPES),
  prompt: z.string().trim().min(1).max(300),
  help: z.string().max(300).optional(),
  options: z.array(z.string().max(120)).max(20).optional(),
  required: z.boolean().optional(),
  max: z.number().int().min(2).max(10).optional(),
  lowLabel: z.string().max(40).optional(),
  highLabel: z.string().max(40).optional(),
});

const AudienceSchema = z.object({
  type: z.enum(AUDIENCE_TYPES).default("all"),
  departmentId: nullableObjectId().optional(),
  locationId: nullableObjectId().optional(),
  employeeIds: z.array(objectId()).max(5000).optional(),
});

const SurveySchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().max(2000).optional(),
  questions: z.array(QuestionSchema).max(50).optional(),
  audience: AudienceSchema.optional(),
  anonymous: z.boolean().optional(),
  closesAt: nullableDateString().optional(),
});

// ── Employee ─────────────────────────────────────────────────────────────────

router.get("/me", requirePermission("survey.respond"), asyncHandler(async (req, res) => ok(res, await service.mine(req.auth))));
router.get("/me/:id", requirePermission("survey.respond"), validate({ params: objectIdParam() }), asyncHandler(async (req, res) => ok(res, await service.getForEmployee(req.params.id, req.auth))));
router.post(
  "/me/:id/respond",
  requirePermission("survey.respond"),
  validate({ params: objectIdParam(), body: z.object({ answers: z.array(z.object({ questionId: z.string().max(20), value: z.unknown() })).max(50) }) }),
  asyncHandler(async (req, res) => ok(res, await service.respond(req.params.id, req.body.answers, req.auth, req)))
);

// ── Admin ────────────────────────────────────────────────────────────────────

router.get("/", requirePermission("survey.manage"), validate({ query: z.object({ status: z.enum(SURVEY_STATUSES).optional() }).passthrough() }), asyncHandler(async (req, res) => ok(res, await service.list(req.query))));
router.post("/", requirePermission("survey.manage"), validate({ body: SurveySchema }), asyncHandler(async (req, res) => created(res, await service.create(req.body, req))));
router.get("/:id", requirePermission("survey.manage"), validate({ params: objectIdParam() }), asyncHandler(async (req, res) => ok(res, await service.get(req.params.id))));
router.patch("/:id", requirePermission("survey.manage"), validate({ params: objectIdParam(), body: SurveySchema.partial() }), asyncHandler(async (req, res) => ok(res, await service.update(req.params.id, req.body, req))));
router.delete("/:id", requirePermission("survey.manage"), validate({ params: objectIdParam() }), asyncHandler(async (req, res) => ok(res, await service.remove(req.params.id, req))));
router.post("/:id/open", requirePermission("survey.manage"), validate({ params: objectIdParam() }), asyncHandler(async (req, res) => ok(res, await service.open(req.params.id, req))));
router.post("/:id/close", requirePermission("survey.manage"), validate({ params: objectIdParam() }), asyncHandler(async (req, res) => ok(res, await service.close(req.params.id, req))));
router.post("/:id/remind", requirePermission("survey.manage"), validate({ params: objectIdParam() }), asyncHandler(async (req, res) => ok(res, await service.remind(req.params.id, req))));
router.get("/:id/results", requirePermission("survey.manage"), validate({ params: objectIdParam() }), asyncHandler(async (req, res) => ok(res, await service.results(req.params.id))));

module.exports = router;
