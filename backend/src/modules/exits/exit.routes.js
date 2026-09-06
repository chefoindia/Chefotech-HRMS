"use strict";

const express = require("express");
const { z } = require("zod");
const service = require("./exit.service");
const { EXIT_TYPES, TASK_OWNERS } = require("./exit.model");
const { authenticate } = require("../auth/authenticate");
const { requirePermission, requireAnyPermission } = require("../../core/rbac/authorize");
const { validate } = require("../../core/validation/validate");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { objectId, objectIdParam, dateString, listQuery } = require("../../core/validation/common");
const { ok, created, paged } = require("../../core/http/response");
const { AppError } = require("../../core/errors/AppError");

const router = express.Router();
router.use(authenticate());

const LineSchema = z.object({ label: z.string().trim().min(1).max(120), detail: z.string().max(200).optional(), amount: z.number().min(0) });

/** The employee's own exit, if one is running. */
router.get("/me", asyncHandler(async (req, res) => ok(res, await service.mine(req.auth))));

/** Clearance tasks assigned to me, across every leaver. */
router.get("/tasks/me", asyncHandler(async (req, res) => ok(res, await service.myTasks(req.auth))));

router.post(
  "/resign",
  validate({ body: z.object({ proposedLastDay: dateString().optional(), reason: z.string().max(2000).optional() }) }),
  asyncHandler(async (req, res) => {
    if (!req.auth.employeeId) throw AppError.badRequest("Your account is not linked to an employee record.");
    return created(res, await service.resign(req.auth.employeeId, req.body, req));
  })
);

router.get("/upcoming", requireAnyPermission("exit.view", "exit.manage", "dashboard.view_org_wide"), asyncHandler(async (req, res) => ok(res, await service.upcoming(Number(req.query.days) || 60))));

router.get(
  "/",
  validate({ query: listQuery({ status: z.string().max(20).optional(), type: z.enum(EXIT_TYPES).optional(), includeClosed: z.string().optional() }) }),
  asyncHandler(async (req, res) => {
    const result = await service.list(req.query, req.auth);
    return paged(res, result.items, result);
  })
);

router.post(
  "/",
  requirePermission("exit.manage"),
  validate({ body: z.object({ employeeId: objectId(), type: z.enum(EXIT_TYPES), lastWorkingDay: dateString(), reason: z.string().max(2000).optional(), noticeWaived: z.boolean().optional(), isRehirable: z.boolean().optional() }) }),
  asyncHandler(async (req, res) => created(res, await service.initiate(req.body, req)))
);

router.get("/:id", validate({ params: objectIdParam() }), asyncHandler(async (req, res) => ok(res, await service.get(req.params.id, req.auth))));

router.post(
  "/:id/decide",
  requirePermission("exit.manage"),
  validate({ params: objectIdParam(), body: z.object({ decision: z.enum(["approve", "reject"]), lastWorkingDay: dateString().optional(), comment: z.string().max(1000).optional(), noticeWaived: z.boolean().optional() }) }),
  asyncHandler(async (req, res) => ok(res, await service.decide(req.params.id, req.body, req)))
);

router.patch(
  "/:id",
  requirePermission("exit.manage"),
  validate({ params: objectIdParam(), body: z.object({ lastWorkingDay: dateString().optional(), noticeWaived: z.boolean().optional(), isRehirable: z.boolean().optional(), exitInterviewNotes: z.string().max(5000).optional(), reason: z.string().max(2000).optional() }) }),
  asyncHandler(async (req, res) => ok(res, await service.update(req.params.id, req.body, req)))
);

router.post(
  "/:id/tasks",
  requirePermission("exit.manage"),
  validate({ params: objectIdParam(), body: z.object({ title: z.string().trim().min(1).max(160), owner: z.enum(TASK_OWNERS).optional(), description: z.string().max(1000).optional() }) }),
  asyncHandler(async (req, res) => ok(res, await service.addTask(req.params.id, req.body, req)))
);

router.post(
  "/:id/tasks/:taskId/complete",
  validate({ params: z.object({ id: objectId(), taskId: objectId() }), body: z.object({ status: z.enum(["done", "skipped"]).optional(), note: z.string().max(500).optional(), recoveryAmount: z.number().min(0).optional() }).optional() }),
  asyncHandler(async (req, res) => ok(res, await service.completeTask(req.params.id, req.params.taskId, req.body || {}, req.auth, req)))
);

router.post("/:id/settlement/compute", requirePermission("exit.manage"), validate({ params: objectIdParam() }), asyncHandler(async (req, res) => ok(res, await service.computeSettlement(req.params.id, req))));

router.patch(
  "/:id/settlement",
  requirePermission("exit.manage"),
  validate({ params: objectIdParam(), body: z.object({ dues: z.array(LineSchema).max(50).optional(), recoveries: z.array(LineSchema).max(50).optional() }) }),
  asyncHandler(async (req, res) => ok(res, await service.updateSettlement(req.params.id, req.body, req)))
);

router.post(
  "/:id/settlement/settle",
  requirePermission("exit.manage"),
  validate({ params: objectIdParam(), body: z.object({ generateDocument: z.boolean().optional() }).optional() }),
  asyncHandler(async (req, res) => {
    if (!req.auth.permissions.includes("payroll.process") && !req.auth.permissions.includes("payroll.assign_salary")) {
      throw AppError.forbidden("Filing a settlement with payroll needs a payroll permission.");
    }
    return ok(res, await service.settle(req.params.id, req.body || {}, req));
  })
);

router.post(
  "/:id/complete",
  requirePermission("exit.manage"),
  validate({ params: objectIdParam(), body: z.object({ generateLetters: z.boolean().optional() }).optional() }),
  asyncHandler(async (req, res) => ok(res, await service.complete(req.params.id, req.body || {}, req)))
);

router.post("/:id/withdraw", validate({ params: objectIdParam() }), asyncHandler(async (req, res) => ok(res, await service.withdraw(req.params.id, req.auth, req))));

module.exports = router;
