"use strict";

const express = require("express");
const { z } = require("zod");
const service = require("./ticket.service");
const { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES } = require("./ticket.model");
const { authenticate } = require("../auth/authenticate");
const { requirePermission, requireAnyPermission } = require("../../core/rbac/authorize");
const { validate } = require("../../core/validation/validate");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { objectId, objectIdParam, listQuery, nullableObjectId } = require("../../core/validation/common");
const { ok, created, paged } = require("../../core/http/response");

const router = express.Router();
router.use(authenticate());

router.get("/catalog", asyncHandler(async (_req, res) => ok(res, { categories: TICKET_CATEGORIES, priorities: TICKET_PRIORITIES, statuses: TICKET_STATUSES })));
router.get("/stats", requirePermission("ticket.manage"), asyncHandler(async (req, res) => ok(res, await service.stats(req.auth))));
router.get("/agents", requirePermission("ticket.manage"), asyncHandler(async (_req, res) => ok(res, await service.agents())));

router.get(
  "/",
  requireAnyPermission("ticket.view_own", "ticket.manage"),
  validate({
    query: listQuery({
      scope: z.enum(["mine", "assigned", "unassigned", "all"]).optional(),
      status: z.enum(TICKET_STATUSES).optional(),
      category: z.enum(TICKET_CATEGORIES).optional(),
      priority: z.enum(TICKET_PRIORITIES).optional(),
      overdue: z.string().optional(),
      includeClosed: z.string().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await service.list(req.query, req.auth);
    return paged(res, result.items, result);
  })
);

router.post(
  "/",
  requirePermission("ticket.create"),
  validate({
    body: z.object({
      subject: z.string().trim().min(3).max(160),
      description: z.string().max(8000).optional(),
      category: z.enum(TICKET_CATEGORIES).optional(),
      priority: z.enum(TICKET_PRIORITIES).optional(),
      attachmentFileIds: z.array(objectId()).max(10).optional(),
    }),
  }),
  asyncHandler(async (req, res) => created(res, await service.create(req.body, req.auth, req)))
);

router.get("/:id", requireAnyPermission("ticket.view_own", "ticket.manage"), validate({ params: objectIdParam() }), asyncHandler(async (req, res) => ok(res, await service.get(req.params.id, req.auth))));

router.post(
  "/:id/comments",
  requireAnyPermission("ticket.view_own", "ticket.manage"),
  validate({ params: objectIdParam(), body: z.object({ body: z.string().trim().min(1).max(4000), internal: z.boolean().optional(), attachmentFileIds: z.array(objectId()).max(10).optional() }) }),
  asyncHandler(async (req, res) => ok(res, await service.comment(req.params.id, req.body, req.auth, req)))
);

router.patch(
  "/:id",
  requirePermission("ticket.manage"),
  validate({
    params: objectIdParam(),
    body: z.object({
      status: z.enum(TICKET_STATUSES).optional(),
      priority: z.enum(TICKET_PRIORITIES).optional(),
      category: z.enum(TICKET_CATEGORIES).optional(),
      assigneeUserId: nullableObjectId(),
      subject: z.string().trim().min(3).max(160).optional(),
      tags: z.array(z.string().max(30)).max(10).optional(),
      resolutionNote: z.string().max(2000).optional(),
    }),
  }),
  asyncHandler(async (req, res) => ok(res, await service.update(req.params.id, req.body, req.auth, req)))
);

router.post(
  "/:id/close",
  requireAnyPermission("ticket.view_own", "ticket.manage"),
  validate({ params: objectIdParam(), body: z.object({ rating: z.number().int().min(1).max(5).optional(), ratingComment: z.string().max(500).optional() }).optional() }),
  asyncHandler(async (req, res) => ok(res, await service.close(req.params.id, req.body || {}, req.auth, req)))
);

router.post("/:id/reopen", requireAnyPermission("ticket.view_own", "ticket.manage"), validate({ params: objectIdParam() }), asyncHandler(async (req, res) => ok(res, await service.reopen(req.params.id, req.auth, req))));

module.exports = router;
