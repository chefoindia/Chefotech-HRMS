"use strict";

const express = require("express");
const { z } = require("zod");
const mongoose = require("mongoose");
const Organization = require("../organizations/organization.model");
const User = require("../users/user.model");
const Membership = require("../rbac/membership.model");
const Employee = require("../employees/employee.model");
const AuditLog = require("../../core/audit/auditLog.model");
const { PLANS, planOf, snapshotFor, ALL_FEATURES } = require("../organizations/plans");
const { authenticate, invalidateOrganizationCache } = require("../auth/authenticate");
const { requirePlatformRole } = require("../../core/rbac/authorize");
const { validate } = require("../../core/validation/validate");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { objectId, objectIdParam, listQuery } = require("../../core/validation/common");
const { ok, paged } = require("../../core/http/response");
const { parseListQuery } = require("../../core/http/queryOptions");
const { AppError } = require("../../core/errors/AppError");
const tenant = require("../../core/tenancy/tenantContext");
const audit = require("../../core/audit/audit.service");
const queue = require("../../core/jobs/queue");
const storage = require("../../core/storage/storage.service");
const { connectDB } = require("../../config/db");

/**
 * Chefotech's own control plane.
 *
 * Two properties matter here:
 *
 *   1. A tenant user reaching any of these routes gets a 404, not a 403 — the
 *      existence of the control plane is not something a customer needs to
 *      learn (see requirePlatformRole).
 *
 *   2. Every cross-tenant read is wrapped in runAsSystem with an explicit
 *      .bypassTenant(), so it is greppable. There is no ambient path by which
 *      platform code accidentally reads across tenants.
 */
const router = express.Router();
router.use(authenticate());
router.use(requirePlatformRole("SUPER_ADMIN", "SYSTEM_ADMIN", "SUPPORT"));

// ── Organizations ───────────────────────────────────────────────────────────

router.get(
  "/organizations",
  validate({ query: listQuery({ status: z.string().optional(), plan: z.string().optional() }) }),
  asyncHandler(async (req, res) => {
    const { page, limit, skip, search } = parseListQuery(req.query, {
      allowedSort: ["createdAt", "name"],
      defaultSort: "-createdAt",
    });

    const filter = { deletedAt: null };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.plan) filter["plan.code"] = req.query.plan;
    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ name: rx }, { slug: rx }, { email: rx }];
    }

    const [items, total] = await Promise.all([
      Organization.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Organization.countDocuments(filter),
    ]);

    return paged(res, items.map(shapeOrganization), { page, limit, total });
  })
);

router.get(
  "/organizations/:id",
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => {
    const organization = await Organization.findById(req.params.id).lean();
    if (!organization) throw AppError.notFound("Organization");

    // Usage figures require reading inside the tenant, which is exactly what
    // runWithTenant is for — even for platform staff.
    const usage = await tenant.runWithTenant(organization._id, async () => {
      const [employees, activeEmployees, users, storageBytes] = await Promise.all([
        Employee.countDocuments({}),
        Employee.countDocuments({ status: { $in: ["active", "on_leave", "notice_period"] } }),
        Membership.countDocuments({ status: { $in: ["active", "invited"] } }),
        storage.StoredFile.aggregate([{ $group: { _id: null, total: { $sum: "$size" } } }])
          .then((r) => (r[0] ? r[0].total : 0))
          .catch(() => 0),
      ]);
      return { employees, activeEmployees, users, storageMb: Math.round(storageBytes / 1024 / 1024) };
    });

    const owner = organization.ownerUserId
      ? await User.findById(organization.ownerUserId).select("email firstName lastName lastLoginAt").lean()
      : null;

    return ok(res, { ...shapeOrganization(organization), usage, owner });
  })
);

router.patch(
  "/organizations/:id/plan",
  requirePlatformRole("SUPER_ADMIN", "SYSTEM_ADMIN"),
  validate({
    params: objectIdParam(),
    body: z.object({
      planCode: z.enum(PLANS.map((p) => p.code)),
      trialEndsAt: z.string().datetime().nullable().optional(),
      currentPeriodEnd: z.string().datetime().nullable().optional(),
      limitOverrides: z
        .object({
          employees: z.number().int().min(1).optional(),
          admins: z.number().int().min(1).optional(),
          biometricDevices: z.number().int().min(0).optional(),
          storageMb: z.number().int().min(0).optional(),
        })
        .optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const organization = await Organization.findById(req.params.id);
    if (!organization) throw AppError.notFound("Organization");

    const before = { ...organization.plan };
    const snapshot = snapshotFor(req.body.planCode);

    organization.plan = {
      ...snapshot,
      trialEndsAt: req.body.trialEndsAt ? new Date(req.body.trialEndsAt) : snapshot.trialEndsAt,
      currentPeriodEnd: req.body.currentPeriodEnd ? new Date(req.body.currentPeriodEnd) : null,
      limits: { ...snapshot.limits, ...(req.body.limitOverrides || {}) },
    };
    if (organization.status === "trial" && req.body.planCode !== "trial") {
      organization.status = "active";
    }

    await organization.save();
    invalidateOrganizationCache(organization._id);

    await audit.record({
      organizationId: organization._id,
      actorId: req.auth.userId,
      actorEmail: req.auth.email,
      actorType: "platform",
      action: "platform.plan_changed",
      entityType: "Organization",
      entityId: organization._id,
      entityLabel: organization.name,
      before,
      after: organization.plan,
      severity: "critical",
    }, req);

    return ok(res, shapeOrganization(organization.toObject()));
  })
);

router.patch(
  "/organizations/:id/features",
  requirePlatformRole("SUPER_ADMIN", "SYSTEM_ADMIN"),
  validate({
    params: objectIdParam(),
    body: z.object({ overrides: z.record(z.boolean()) }),
  }),
  asyncHandler(async (req, res) => {
    const unknown = Object.keys(req.body.overrides).filter((f) => !ALL_FEATURES.includes(f));
    if (unknown.length) {
      throw AppError.badRequest(`Unknown feature(s): ${unknown.join(", ")}`, { available: ALL_FEATURES });
    }

    const organization = await Organization.findById(req.params.id);
    if (!organization) throw AppError.notFound("Organization");

    const before = Object.fromEntries(organization.featureOverrides || []);
    for (const [feature, enabled] of Object.entries(req.body.overrides)) {
      organization.featureOverrides.set(feature, enabled);
    }
    await organization.save();
    invalidateOrganizationCache(organization._id);

    await audit.record({
      organizationId: organization._id,
      actorId: req.auth.userId,
      actorType: "platform",
      action: "platform.features_changed",
      entityType: "Organization",
      entityId: organization._id,
      entityLabel: organization.name,
      before,
      after: Object.fromEntries(organization.featureOverrides),
      severity: "warning",
    }, req);

    return ok(res, { featureOverrides: Object.fromEntries(organization.featureOverrides) });
  })
);

router.post(
  "/organizations/:id/suspend",
  requirePlatformRole("SUPER_ADMIN"),
  validate({
    params: objectIdParam(),
    body: z.object({ reason: z.string().trim().min(5, "Give a reason").max(300) }),
  }),
  asyncHandler(async (req, res) => {
    const organization = await Organization.findById(req.params.id);
    if (!organization) throw AppError.notFound("Organization");

    organization.status = "suspended";
    organization.suspendedReason = req.body.reason;
    await organization.save();
    invalidateOrganizationCache(organization._id);

    await audit.record({
      organizationId: organization._id,
      actorId: req.auth.userId,
      actorType: "platform",
      action: "platform.organization_suspended",
      entityType: "Organization",
      entityId: organization._id,
      entityLabel: organization.name,
      after: { reason: req.body.reason },
      severity: "critical",
    }, req);

    return ok(res, { id: String(organization._id), status: organization.status });
  })
);

router.post(
  "/organizations/:id/reactivate",
  requirePlatformRole("SUPER_ADMIN"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => {
    const organization = await Organization.findById(req.params.id);
    if (!organization) throw AppError.notFound("Organization");

    organization.status = organization.plan.code === "trial" ? "trial" : "active";
    organization.suspendedReason = null;
    await organization.save();
    invalidateOrganizationCache(organization._id);

    await audit.record({
      organizationId: organization._id,
      actorId: req.auth.userId,
      actorType: "platform",
      action: "platform.organization_reactivated",
      entityType: "Organization",
      entityId: organization._id,
      entityLabel: organization.name,
      severity: "critical",
    }, req);

    return ok(res, { id: String(organization._id), status: organization.status });
  })
);

// ── Platform overview ───────────────────────────────────────────────────────

router.get(
  "/overview",
  asyncHandler(async (_req, res) => {
    const [byStatus, byPlan, totals, recent] = await Promise.all([
      Organization.aggregate([
        { $match: { deletedAt: null } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Organization.aggregate([
        { $match: { deletedAt: null } },
        { $group: { _id: "$plan.code", count: { $sum: 1 } } },
      ]),
      Promise.all([
        Organization.countDocuments({ deletedAt: null }),
        User.countDocuments({ deletedAt: null, isPlatformUser: false }),
        tenant.runAsSystem(
          () => Employee.find({}).setOptions({ bypassTenant: true }).countDocuments(),
          "platform.overview"
        ),
      ]),
      Organization.find({ deletedAt: null })
        .sort({ createdAt: -1 })
        .limit(10)
        .select("name slug status plan.code createdAt")
        .lean(),
    ]);

    const [organizations, users, employees] = totals;

    return ok(res, {
      organizations,
      users,
      employees,
      byStatus: Object.fromEntries(byStatus.map((r) => [r._id, r.count])),
      byPlan: Object.fromEntries(byPlan.map((r) => [r._id, r.count])),
      recentSignups: recent,
    });
  })
);

router.get(
  "/health",
  asyncHandler(async (_req, res) => {
    const [dbState, jobStats, storageHealth] = await Promise.all([
      Promise.resolve(mongoose.connection.readyState),
      queue.stats().catch(() => null),
      storage.healthCheck().catch((err) => ({ ok: false, reason: err.message })),
    ]);

    const failedJobs = jobStats ? jobStats.failed : 0;

    return ok(res, {
      status: dbState === 1 && storageHealth.ok && failedJobs < 50 ? "healthy" : "degraded",
      database: {
        connected: dbState === 1,
        state: ["disconnected", "connected", "connecting", "disconnecting"][dbState] || "unknown",
      },
      jobs: jobStats,
      storage: storageHealth,
      uptimeSeconds: Math.round(process.uptime()),
      memory: {
        rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      },
      nodeVersion: process.version,
    });
  })
);

// ── Jobs ────────────────────────────────────────────────────────────────────

router.get(
  "/jobs",
  validate({ query: listQuery({ status: z.string().optional(), name: z.string().optional() }) }),
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parseListQuery(req.query, {
      allowedSort: ["createdAt", "runAt"],
      defaultSort: "-createdAt",
    });

    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.name) filter.name = req.query.name;

    const [items, total] = await Promise.all([
      queue.Job.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      queue.Job.countDocuments(filter),
    ]);

    return paged(res, items, { page, limit, total, registered: queue.registeredJobs() });
  })
);

router.post(
  "/jobs/:id/retry",
  requirePlatformRole("SUPER_ADMIN", "SYSTEM_ADMIN"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => {
    const job = await queue.Job.findById(req.params.id);
    if (!job) throw AppError.notFound("Job");
    if (job.status !== "failed") throw AppError.badRequest("Only a failed job can be retried.");

    job.status = "queued";
    job.attempts = 0;
    job.runAt = new Date();
    job.lastError = null;
    await job.save();

    return ok(res, { id: String(job._id), requeued: true });
  })
);

// ── Cross-tenant audit ──────────────────────────────────────────────────────

router.get(
  "/audit",
  requirePlatformRole("SUPER_ADMIN"),
  validate({
    query: listQuery({
      organizationId: objectId().optional(),
      severity: z.string().optional(),
      action: z.string().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parseListQuery(req.query, {
      allowedSort: ["occurredAt"],
      defaultSort: "-occurredAt",
    });

    const filter = {};
    if (req.query.organizationId) filter.organizationId = req.query.organizationId;
    if (req.query.severity) filter.severity = req.query.severity;
    if (req.query.action) filter.action = req.query.action;

    const [items, total] = await Promise.all([
      AuditLog.find(filter).sort({ occurredAt: -1 }).skip(skip).limit(limit).lean(),
      AuditLog.countDocuments(filter),
    ]);

    return paged(res, items, { page, limit, total });
  })
);

// ── Plans ───────────────────────────────────────────────────────────────────

router.get(
  "/plans",
  asyncHandler(async (_req, res) => ok(res, PLANS))
);

function shapeOrganization(organization) {
  return {
    id: String(organization._id),
    name: organization.name,
    slug: organization.slug,
    email: organization.email,
    status: organization.status,
    suspendedReason: organization.suspendedReason,
    plan: organization.plan,
    industry: organization.industry,
    companySize: organization.companySize,
    country: organization.address && organization.address.country,
    timezone: organization.timezone,
    onboarding: {
      status: organization.onboarding && organization.onboarding.status,
    },
    usage: organization.usage,
    createdAt: organization.createdAt,
  };
}

module.exports = router;
