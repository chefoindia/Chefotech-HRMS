"use strict";

const express = require("express");
const { z } = require("zod");
const service = require("./integration.service");
const { authenticate } = require("../auth/authenticate");
const { requirePermission } = require("../../core/rbac/authorize");
const { validate } = require("../../core/validation/validate");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { objectIdParam, nullableDateString } = require("../../core/validation/common");
const { ok, created } = require("../../core/http/response");
const { AppError } = require("../../core/errors/AppError");

const router = express.Router();
router.use(authenticate());
router.use(requirePermission("settings.manage_integrations"));

/** Keys and webhooks may not be managed by a key: a leaked key must not be able to mint more. */
router.use((req, _res, next) => {
  if (req.auth && req.auth.isApiKey) return next(AppError.forbidden("Integrations are managed from the web app, not through an API key."));
  return next();
});

router.get("/events", asyncHandler(async (_req, res) => ok(res, service.eventCatalog())));

router.get("/api-keys", asyncHandler(async (_req, res) => ok(res, await service.listApiKeys())));
router.post(
  "/api-keys",
  validate({ body: z.object({ name: z.string().trim().min(1).max(80), scopes: z.array(z.string().max(60)).min(1).max(100), expiresAt: nullableDateString() }) }),
  asyncHandler(async (req, res) => created(res, await service.createApiKey(req.body, req.auth, req)))
);
router.post("/api-keys/:id/revoke", validate({ params: objectIdParam() }), asyncHandler(async (req, res) => ok(res, await service.revokeApiKey(req.params.id, req))));

router.get("/webhooks", asyncHandler(async (_req, res) => ok(res, await service.listWebhooks())));
router.post(
  "/webhooks",
  validate({ body: z.object({ name: z.string().trim().min(1).max(80), url: z.string().url().max(500), events: z.array(z.string().max(60)).min(1).max(100) }) }),
  asyncHandler(async (req, res) => created(res, await service.createWebhook(req.body, req)))
);
router.patch(
  "/webhooks/:id",
  validate({ params: objectIdParam(), body: z.object({ name: z.string().trim().min(1).max(80).optional(), url: z.string().url().max(500).optional(), events: z.array(z.string().max(60)).max(100).optional(), isActive: z.boolean().optional() }) }),
  asyncHandler(async (req, res) => ok(res, await service.updateWebhook(req.params.id, req.body, req)))
);
router.post("/webhooks/:id/rotate-secret", validate({ params: objectIdParam() }), asyncHandler(async (req, res) => ok(res, await service.rotateSecret(req.params.id, req))));
router.post("/webhooks/:id/test", validate({ params: objectIdParam() }), asyncHandler(async (req, res) => ok(res, await service.test(req.params.id, req))));
router.get("/webhooks/:id/deliveries", validate({ params: objectIdParam() }), asyncHandler(async (req, res) => ok(res, await service.listDeliveries(req.params.id, { limit: Number(req.query.limit) || 50 }))));
router.delete("/webhooks/:id", validate({ params: objectIdParam() }), asyncHandler(async (req, res) => ok(res, await service.deleteWebhook(req.params.id, req))));

module.exports = router;
