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
const NotificationRule = require("./notificationRule.model");
const notificationTemplates = require("./notificationTemplates");
const defaultRules = require("./defaultRules");
const { AppError } = require("../../core/errors/AppError");
const mailer = require("./mailer");
const { env } = require("../../config/env");

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


// ── Notification rules: "when this happens, tell these people" ──────────────

/**
 * Gated on notification.manage_templates, the same permission that governs
 * changing what a message says. Deciding who receives payroll and leave
 * notifications is at least as sensitive as wording them, and a rule pointed
 * at an external address is a route for data to leave the tenant — so this is
 * not something a general settings permission should unlock.
 */

const RecipientSchema = z
  .object({
    type: z.enum(NotificationRule.RECIPIENT_TYPES),
    roleIds: z.array(objectId()).optional(),
    userIds: z.array(objectId()).optional(),
    employeeIds: z.array(objectId()).optional(),
    email: z.string().email().optional(),
  })
  .refine((value) => value.type !== "email" || Boolean(value.email), {
    message: "An external recipient needs an email address",
  })
  .refine((value) => value.type !== "role" || (value.roleIds || []).length > 0, {
    message: "Choose at least one role",
  });

const RuleSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(300).optional(),
  event: z.string().trim().min(1).max(80),
  templateKey: z.string().max(80).nullable().optional(),
  condition: z.string().max(500).nullable().optional(),
  recipients: z.array(RecipientSchema).min(1, "A rule needs at least one recipient"),
  channels: z.array(z.enum(["in_app", "email", "push"])).nullable().optional(),
  isActive: z.boolean().optional(),
});

/** The events a rule can be bound to, so the UI never offers a dead one. */
router.get(
  "/rules/events",
  requirePermission("notification.manage_templates"),
  asyncHandler(async (_req, res) => {
    const seen = new Map();
    for (const [key, template] of Object.entries(notificationTemplates.TEMPLATES)) {
      if (!seen.has(template.event)) {
        seen.set(template.event, {
          event: template.event,
          templateKey: key,
          title: template.title || key,
          channels: template.channels || [],
        });
      }
    }
    return ok(res, [...seen.values()]);
  })
);

router.get(
  "/rules",
  requirePermission("notification.manage_templates"),
  asyncHandler(async (_req, res) =>
    ok(res, await NotificationRule.find({}).sort({ event: 1, name: 1 }).lean())
  )
);

router.post(
  "/rules",
  requirePermission("notification.manage_templates"),
  validate({ body: RuleSchema }),
  asyncHandler(async (req, res) => {
    const rule = await NotificationRule.create(req.body);
    await audit.record(
      {
        action: "notification.rule_created",
        entityType: "NotificationRule",
        entityId: rule._id,
        entityLabel: rule.name,
        after: { event: rule.event, recipients: rule.recipients.length },
        severity: "notice",
      },
      req
    );
    return ok(res, rule.toObject());
  })
);

router.patch(
  "/rules/:id",
  requirePermission("notification.manage_templates"),
  validate({ params: z.object({ id: objectId() }), body: RuleSchema.partial() }),
  asyncHandler(async (req, res) => {
    const rule = await NotificationRule.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!rule) throw AppError.notFound("Notification rule");

    await audit.record(
      {
        action: "notification.rule_updated",
        entityType: "NotificationRule",
        entityId: rule._id,
        entityLabel: rule.name,
        after: { event: rule.event, isActive: rule.isActive },
        severity: "notice",
      },
      req
    );
    return ok(res, rule.toObject());
  })
);

router.delete(
  "/rules/:id",
  requirePermission("notification.manage_templates"),
  validate({ params: z.object({ id: objectId() }) }),
  asyncHandler(async (req, res) => {
    const rule = await NotificationRule.findByIdAndDelete(req.params.id);
    if (!rule) throw AppError.notFound("Notification rule");

    await audit.record(
      {
        action: "notification.rule_deleted",
        entityType: "NotificationRule",
        entityId: rule._id,
        entityLabel: rule.name,
        before: { event: rule.event },
        severity: "warning",
      },
      req
    );
    return ok(res, { deleted: true });
  })
);

/**
 * Seed the defaults.
 *
 * Never overwrites: a rule the customer already has for an event is left
 * exactly as they wrote it, and only genuinely absent defaults are added. That
 * makes this safe to call more than once, which matters because it is
 * reachable from a button.
 */
router.post(
  "/rules/seed-defaults",
  requirePermission("notification.manage_templates"),
  asyncHandler(async (req, res) => {
    const Role = require("../rbac/role.model");
    const { rules, skipped } = await defaultRules.materialise(Role);

    const existing = await NotificationRule.find({}).select("event name").lean();
    const taken = new Set(existing.map((r) => `${r.event}::${r.name}`));

    const toCreate = rules.filter((rule) => !taken.has(`${rule.event}::${rule.name}`));
    const created = toCreate.length ? await NotificationRule.insertMany(toCreate) : [];

    await audit.record(
      {
        action: "notification.rules_seeded",
        entityType: "NotificationRule",
        after: { created: created.length, skipped: skipped.length },
        severity: "notice",
      },
      req
    );

    return ok(res, { created: created.length, skipped, alreadyPresent: rules.length - toCreate.length });
  })
);


/**
 * Is mail actually going to work?
 *
 * Added because there was no way to answer that question from outside the
 * source. Mail can fail for three unrelated reasons that all look identical
 * from a user's seat — "I never got the email" — and each needs a different
 * fix: the switch is off, the credential is rejected, or the sender address
 * is not verified with the provider. This reports which.
 */
router.get(
  "/mail/health",
  requirePermission("notification.manage_templates"),
  asyncHandler(async (_req, res) => {
    const verify = env.mail.enabled
      ? await mailer.verify()
      : { ok: false, reason: "MAIL_ENABLED is not true — no mail will be sent" };

    return ok(res, {
      enabled: env.mail.enabled,
      driver: env.mail.driver,
      from: env.mail.from,
      brevoKeySet: Boolean(env.mail.brevo.apiKey),
      smtpHostSet: Boolean(env.mail.host),
      reachable: verify.ok,
      reason: verify.reason || null,
    });
  })
);

module.exports = router;
