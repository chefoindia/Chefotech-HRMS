"use strict";

const express = require("express");
const { z } = require("zod");
const service = require("./notification.service");
const Employee = require("../employees/employee.model");
const Organization = require("../organizations/organization.model");
const Membership = require("../rbac/membership.model");
const User = require("../users/user.model");
const { authenticate } = require("../auth/authenticate");
const { requirePermission } = require("../../core/rbac/authorize");
const { validate } = require("../../core/validation/validate");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { objectId, listQuery } = require("../../core/validation/common");
const { ok, paged } = require("../../core/http/response");
const tenant = require("../../core/tenancy/tenantContext");
const audit = require("../../core/audit/audit.service");

const router = express.Router();
router.use(authenticate());

// ── The bell ────────────────────────────────────────────────────────────────

router.get(
  "/",
  validate({ query: listQuery({ unreadOnly: z.string().optional(), category: z.string().optional() }) }),
  asyncHandler(async (req, res) => {
    const result = await service.listForUser(req.auth.userId, req.query);
    return paged(res, result.items, result);
  })
);

router.get(
  "/unread-count",
  asyncHandler(async (req, res) => ok(res, { count: await service.unreadCount(req.auth.userId) }))
);

router.post(
  "/read",
  validate({ body: z.object({ ids: z.array(objectId()).max(200).optional() }) }),
  asyncHandler(async (req, res) => ok(res, await service.markRead(req.auth.userId, req.body.ids)))
);

// ── Templates ───────────────────────────────────────────────────────────────

router.get(
  "/templates",
  requirePermission("notification.manage_templates"),
  asyncHandler(async (_req, res) => ok(res, await service.listTemplates()))
);

router.patch(
  "/templates/:key",
  requirePermission("notification.manage_templates"),
  validate({
    params: z.object({ key: z.string().max(60) }),
    body: z.object({
      subject: z.string().max(200).nullable().optional(),
      title: z.string().max(200).nullable().optional(),
      body: z.string().max(5000).nullable().optional(),
      channels: z.array(z.enum(["in_app", "email", "push", "sms"])).nullable().optional(),
      enabled: z.boolean().optional(),
      isHtml: z.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const updated = await service.updateTemplate(req.params.key, req.body);
    await audit.record(
      {
        action: "notification.template_updated",
        entityType: "EmailTemplate",
        entityId: updated._id,
        entityLabel: req.params.key,
        severity: "notice",
      },
      req
    );
    return ok(res, updated);
  })
);

router.delete(
  "/templates/:key",
  requirePermission("notification.manage_templates"),
  validate({ params: z.object({ key: z.string().max(60) }) }),
  asyncHandler(async (req, res) => ok(res, await service.resetTemplate(req.params.key)))
);

/** Render a template against sample data without sending anything. */
router.post(
  "/templates/:key/preview",
  requirePermission("notification.manage_templates"),
  validate({
    params: z.object({ key: z.string().max(60) }),
    body: z.object({ data: z.record(z.any()).optional() }),
  }),
  asyncHandler(async (req, res) => {
    const templates = require("./notificationTemplates");
    const template = await service.resolveTemplate(req.params.key);
    const organization = await tenant.runAsSystem(
      () => Organization.findById(tenant.requireOrganizationId()).lean(),
      "notification.preview"
    );

    const sample = {
      firstName: req.auth.firstName || "Ravi",
      employee: { name: "Ravi Kumar", firstName: "Ravi" },
      approver: { name: req.auth.name },
      leave: { type: "Casual Leave", from: "2026-09-01", to: "2026-09-03", days: 3, reason: "Family function" },
      period: { label: "August 2026" },
      company: { name: organization.name, ...(organization.branding || {}) },
      ...(req.body.data || {}),
    };

    return ok(res, {
      subject: templates.render(template.subject, sample),
      title: templates.render(template.title, sample),
      body: templates.render(template.body, sample),
      channels: template.channels,
    });
  })
);

// ── Announcements ───────────────────────────────────────────────────────────

router.post(
  "/announce",
  requirePermission("notification.broadcast"),
  validate({
    body: z.object({
      title: z.string().trim().min(3).max(120),
      message: z.string().trim().min(3).max(4000),
      audience: z.enum(["all", "department", "location", "employees"]).default("all"),
      departmentId: objectId().optional(),
      locationId: objectId().optional(),
      employeeIds: z.array(objectId()).max(500).optional(),
      channels: z.array(z.enum(["in_app", "email"])).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { title, message, audience, departmentId, locationId, employeeIds, channels } = req.body;

    const filter = { status: { $in: ["active", "on_leave", "notice_period"] }, userId: { $ne: null } };
    if (audience === "department" && departmentId) filter["employment.departmentId"] = departmentId;
    if (audience === "location" && locationId) filter["employment.locationId"] = locationId;
    if (audience === "employees" && employeeIds) filter._id = { $in: employeeIds };

    const employees = await Employee.find(filter)
      .select("userId personal.firstName personal.workEmail")
      .lean();

    const organization = await tenant.runAsSystem(
      () => Organization.findById(tenant.requireOrganizationId()).lean(),
      "notification.announce"
    );

    const result = await service.notify({
      template: "announcement",
      recipients: employees.map((e) => ({
        userId: e.userId,
        employeeId: e._id,
        email: e.personal.workEmail,
        firstName: e.personal.firstName,
      })),
      organization,
      data: { title, message },
      severity: "info",
      channels: channels || null,
    });

    await audit.record(
      {
        action: "notification.announcement_sent",
        entityType: "Notification",
        entityLabel: title,
        after: { audience, recipients: employees.length, sent: result.sent },
        severity: "notice",
      },
      req
    );

    return ok(res, { ...result, recipients: employees.length });
  })
);

module.exports = router;
