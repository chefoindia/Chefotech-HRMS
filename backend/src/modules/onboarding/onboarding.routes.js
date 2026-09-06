"use strict";

const express = require("express");
const { z } = require("zod");
const service = require("./onboarding.service");
const { TASK_OWNERS } = require("./onboarding.model");
const { authenticate } = require("../auth/authenticate");
const { requirePermission, requireAnyPermission } = require("../../core/rbac/authorize");
const { validate } = require("../../core/validation/validate");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { objectId, objectIdParam, dateString, listQuery, nullableObjectId } = require("../../core/validation/common");
const { ok, created, paged } = require("../../core/http/response");

const router = express.Router();
router.use(authenticate());

const TemplateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).optional(),
  appliesTo: z.object({ departmentIds: z.array(objectId()).max(50).optional(), employmentTypes: z.array(z.string().max(30)).max(10).optional() }).optional(),
  tasks: z.array(z.object({ title: z.string().trim().min(1).max(160), description: z.string().max(1000).optional(), owner: z.enum(TASK_OWNERS).optional(), dueOffsetDays: z.number().int().min(-90).max(365).optional(), autoComplete: z.enum(["", "portal_invited", "documents_verified", "assets_assigned", "policies_acknowledged", "bank_details"]).optional() })).max(60),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

// Templates
router.get("/templates", requireAnyPermission("onboarding.view", "onboarding.manage"), asyncHandler(async (_req, res) => ok(res, await service.listTemplates())));
router.post("/templates/seed-default", requirePermission("onboarding.manage"), asyncHandler(async (_req, res) => ok(res, await service.seedDefault())));
router.post("/templates", requirePermission("onboarding.manage"), validate({ body: TemplateSchema }), asyncHandler(async (req, res) => created(res, await service.createTemplate(req.body, req))));
router.patch("/templates/:id", requirePermission("onboarding.manage"), validate({ params: objectIdParam(), body: TemplateSchema.partial() }), asyncHandler(async (req, res) => ok(res, await service.updateTemplate(req.params.id, req.body, req))));
router.delete("/templates/:id", requirePermission("onboarding.manage"), validate({ params: objectIdParam() }), asyncHandler(async (req, res) => ok(res, await service.deleteTemplate(req.params.id, req))));

// Mine
router.get("/me", asyncHandler(async (req, res) => ok(res, await service.mine(req.auth))));
router.get("/tasks/me", asyncHandler(async (req, res) => ok(res, await service.myTasks(req.auth))));

// Instances
router.get(
  "/",
  validate({ query: listQuery({ status: z.enum(["in_progress", "completed", "cancelled"]).optional() }) }),
  asyncHandler(async (req, res) => {
    const result = await service.list(req.query, req.auth);
    return paged(res, result.items, result);
  })
);
router.post(
  "/",
  requirePermission("onboarding.manage"),
  validate({ body: z.object({ employeeId: objectId(), templateId: objectId().optional(), buddyEmployeeId: nullableObjectId(), welcomeNote: z.string().max(2000).optional() }) }),
  asyncHandler(async (req, res) => created(res, await service.start(req.body, req)))
);
router.post("/run-auto", requirePermission("onboarding.manage"), asyncHandler(async (_req, res) => ok(res, await service.runAutoCompletions())));
router.get("/:id", validate({ params: objectIdParam() }), asyncHandler(async (req, res) => ok(res, await service.get(req.params.id, req.auth))));
router.patch("/:id", requirePermission("onboarding.manage"), validate({ params: objectIdParam(), body: z.object({ buddyEmployeeId: nullableObjectId(), welcomeNote: z.string().max(2000).optional() }) }), asyncHandler(async (req, res) => ok(res, await service.update(req.params.id, req.body, req))));
router.post("/:id/cancel", requirePermission("onboarding.manage"), validate({ params: objectIdParam() }), asyncHandler(async (req, res) => ok(res, await service.cancel(req.params.id, req))));
router.post(
  "/:id/tasks",
  requirePermission("onboarding.manage"),
  validate({ params: objectIdParam(), body: z.object({ title: z.string().trim().min(1).max(160), owner: z.enum(TASK_OWNERS).optional(), dueOn: dateString().optional(), description: z.string().max(1000).optional() }) }),
  asyncHandler(async (req, res) => ok(res, await service.addTask(req.params.id, req.body, req)))
);
router.post(
  "/:id/tasks/:taskId/complete",
  validate({ params: z.object({ id: objectId(), taskId: objectId() }), body: z.object({ status: z.enum(["done", "skipped"]).optional(), note: z.string().max(500).optional() }).optional() }),
  asyncHandler(async (req, res) => ok(res, await service.completeTask(req.params.id, req.params.taskId, req.body || {}, req.auth, req)))
);
router.post(
  "/:id/tasks/:taskId/reassign",
  requirePermission("onboarding.manage"),
  validate({ params: z.object({ id: objectId(), taskId: objectId() }), body: z.object({ assigneeUserId: nullableObjectId() }) }),
  asyncHandler(async (req, res) => ok(res, await service.reassignTask(req.params.id, req.params.taskId, req.body, req)))
);

module.exports = router;
