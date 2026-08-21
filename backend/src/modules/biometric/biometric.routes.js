"use strict";

const express = require("express");
const { z } = require("zod");
const service = require("./biometric.service");
const { listProviders } = require("./adapters");
const { authenticate } = require("../auth/authenticate");
const { requirePermission } = require("../../core/rbac/authorize");
const { requireFeature } = require("../organizations/planGuard");
const { FEATURES } = require("../organizations/plans");
const { validate } = require("../../core/validation/validate");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { uploadSingle } = require("../../core/http/upload");
const { objectId, objectIdParam, dateString } = require("../../core/validation/common");
const { ok, created } = require("../../core/http/response");
const { heavyLimiter } = require("../../core/security/rateLimit");
const organizationService = require("../organizations/organization.service");
const { logger } = require("../../config/logger");

const DeviceSchema = z.object({
  name: z.string().trim().min(1).max(60),
  code: z.string().trim().min(1).max(20),
  provider: z.string().trim().min(1).max(40),
  mode: z.enum(["lan", "http", "cloud", "webhook", "file", "manual"]).optional(),
  connection: z
    .object({
      host: z.string().max(120).optional(),
      port: z.number().int().min(1).max(65535).nullable().optional(),
      baseUrl: z.string().max(300).optional(),
      username: z.string().max(80).optional(),
      password: z.string().max(200).optional(),
      apiKey: z.string().max(300).optional(),
      serialNumber: z.string().max(60).optional(),
      deviceNumber: z.number().int().optional(),
      useSsl: z.boolean().optional(),
      timeoutMs: z.number().int().min(1000).max(120000).optional(),
      extra: z.record(z.any()).optional(),
    })
    .optional(),
  locationId: objectId().nullable().optional(),
  timezone: z.string().max(60).nullable().optional(),
  defaultDirection: z.enum(["in", "out"]).nullable().optional(),
  sync: z
    .object({
      enabled: z.boolean().optional(),
      intervalMinutes: z.number().int().min(1).max(1440).optional(),
    })
    .optional(),
  isActive: z.boolean().optional(),
  notes: z.string().max(500).optional(),
});

const router = express.Router();

/**
 * The webhook is authenticated by the device's own secret, not by a user
 * session, so it is mounted BEFORE the authenticate() middleware. A device
 * has no JWT and never will.
 */
router.post(
  "/webhook/:deviceCode",
  express.json({ limit: "1mb" }),
  validate({ params: z.object({ deviceCode: z.string().max(20) }) }),
  asyncHandler(async (req, res) => {
    const secret = req.headers["x-device-secret"] || req.query.secret;

    // The device does not know its own tenant, so the code is resolved across
    // organizations — the shared secret is what proves which one it belongs to.
    const tenant = require("../../core/tenancy/tenantContext");
    const BiometricDevice = require("./biometricDevice.model");

    const device = await tenant.runAsSystem(
      () =>
        BiometricDevice.findOne({ code: String(req.params.deviceCode).toUpperCase() })
          .setOptions({ bypassTenant: true })
          .select("organizationId")
          .lean(),
      "biometric.webhook-lookup"
    );

    if (!device) {
      // Same response as a bad secret: an unauthenticated caller learns nothing.
      return res.status(401).json({
        success: false,
        error: { code: "UNAUTHENTICATED", message: "Invalid device credentials." },
      });
    }

    const result = await tenant.runWithTenant(device.organizationId, () =>
      service.ingestWebhook(req.params.deviceCode, req.body, secret, req)
    );

    logger.info({ device: req.params.deviceCode, received: result.received }, "Biometric webhook ingested");
    return ok(res, result);
  })
);

router.use(authenticate());
router.use(requireFeature(FEATURES.BIOMETRIC));

/** Adapter catalog for the "add a device" screen. */
router.get(
  "/providers",
  requirePermission("biometric.view"),
  asyncHandler(async (_req, res) => ok(res, listProviders()))
);

// ── Devices ─────────────────────────────────────────────────────────────────

router.get(
  "/devices",
  requirePermission("biometric.view"),
  asyncHandler(async (req, res) => ok(res, await service.listDevices(req.query)))
);

router.post(
  "/devices",
  requirePermission("biometric.manage"),
  validate({ body: DeviceSchema }),
  asyncHandler(async (req, res) => {
    const device = await service.createDevice(req.body, req);
    await organizationService.markStepCompleteIfPending("biometric");
    return created(res, device);
  })
);

router.patch(
  "/devices/:id",
  requirePermission("biometric.manage"),
  validate({ params: objectIdParam(), body: DeviceSchema.partial() }),
  asyncHandler(async (req, res) => ok(res, await service.updateDevice(req.params.id, req.body, req)))
);

router.delete(
  "/devices/:id",
  requirePermission("biometric.manage"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => ok(res, await service.deleteDevice(req.params.id, req)))
);

router.post(
  "/devices/:id/test",
  requirePermission("biometric.manage"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => ok(res, await service.testConnection(req.params.id)))
);

router.post(
  "/devices/:id/sync",
  requirePermission("biometric.sync"),
  heavyLimiter,
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) =>
    ok(res, await service.syncDevice(req.params.id, { trigger: "manual", req }))
  )
);

router.post(
  "/devices/:id/import",
  requirePermission("biometric.sync"),
  heavyLimiter,
  validate({ params: objectIdParam() }),
  uploadSingle("file"),
  asyncHandler(async (req, res) => ok(res, await service.importFile(req.params.id, req.file, req)))
);

// ── Events and logs ─────────────────────────────────────────────────────────

router.get(
  "/events",
  requirePermission("biometric.view"),
  validate({
    query: z.object({
      deviceId: objectId().optional(),
      employeeId: objectId().optional(),
      status: z.enum(["pending", "mapped", "unmapped", "duplicate", "ignored", "error"]).optional(),
      fromDate: dateString().optional(),
      toDate: dateString().optional(),
      limit: z.coerce.number().int().min(1).max(500).optional(),
    }),
  }),
  asyncHandler(async (req, res) => ok(res, await service.listEvents(req.query)))
);

router.get(
  "/unmapped",
  requirePermission("biometric.view"),
  validate({ query: z.object({ deviceId: objectId().optional() }) }),
  asyncHandler(async (req, res) => ok(res, await service.unmappedSummary(req.query.deviceId)))
);

router.post(
  "/reprocess",
  requirePermission("biometric.reprocess"),
  heavyLimiter,
  validate({
    body: z.object({
      deviceId: objectId().optional(),
      fromDate: dateString().optional(),
    }),
  }),
  asyncHandler(async (req, res) => ok(res, await service.reprocessUnmapped(req.body, req)))
);

router.get(
  "/sync-logs",
  requirePermission("biometric.view"),
  validate({
    query: z.object({
      deviceId: objectId().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    }),
  }),
  asyncHandler(async (req, res) =>
    ok(res, await service.listSyncLogs(req.query.deviceId, req.query.limit))
  )
);

module.exports = router;
