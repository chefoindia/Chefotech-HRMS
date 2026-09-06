"use strict";

const express = require("express");
const { z } = require("zod");
const service = require("./notification.service");
const announcements = require("./announcement.service");
const outbound = require("./outbound.service");
const push = require("./push.service");
const preferences = require("./preference.service");
const digest = require("./digest.service");
const Organization = require("../organizations/organization.model");
const { authenticate } = require("../auth/authenticate");
const { requirePermission, requireAnyPermission } = require("../../core/rbac/authorize");
const { validate } = require("../../core/validation/validate");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { objectId, objectIdParam, listQuery, dateString } = require("../../core/validation/common");
const { ok, paged, created } = require("../../core/http/response");
const tenant = require("../../core/tenancy/tenantContext");
const audit = require("../../core/audit/audit.service");
const NotificationRule = require("./notificationRule.model");
const notificationTemplates = require("./notificationTemplates");
const defaultRules = require("./defaultRules");
const { CATEGORIES } = require("./notificationPreference.model");
const { AppError } = require("../../core/errors/AppError");
const mailer = require("./mailer");
const { env } = require("../../config/env");

const router = express.Router();
router.use(authenticate());

const CHANNELS = ["in_app", "email", "push", "sms"];

// ── The bell and the notification centre ────────────────────────────────────

router.get(
  "/",
  validate({
    query: listQuery({
      unreadOnly: z.string().optional(),
      category: z.string().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await service.listForUser(req.auth.userId, req.query);
    return paged(res, result.items, result);
  })
);

router.get(
  "/unread-count",
  asyncHandler(async (req, res) => ok(res, { count: await service.unreadCount(req.auth.userId) }))
);

router.get(
  "/summary",
  asyncHandler(async (req, res) => ok(res, await service.summaryForUser(req.auth.userId)))
);

router.post(
  "/read",
  validate({ body: z.object({ ids: z.array(objectId()).max(200).optional() }) }),
  asyncHandler(async (req, res) => ok(res, await service.markRead(req.auth.userId, req.body.ids)))
);

router.post(
  "/clear-read",
  asyncHandler(async (req, res) => ok(res, await service.clearRead(req.auth.userId)))
);

// ── Preferences ─────────────────────────────────────────────────────────────

router.get(
  "/preferences",
  asyncHandler(async (req, res) =>
    ok(res, { ...(await preferences.forUser(req.auth.userId)), categories: CATEGORIES })
  )
);

router.put(
  "/preferences",
  validate({
    body: z.object({
      emailEnabled: z.boolean().optional(),
      pushEnabled: z.boolean().optional(),
      dailyDigest: z.boolean().optional(),
      muted: z
        .array(z.object({ category: z.enum(CATEGORIES), channel: z.enum(["email", "push"]) }))
        .max(50)
        .optional(),
      quietHours: z
        .object({
          enabled: z.boolean().optional(),
          start: z.string().optional(),
          end: z.string().optional(),
        })
        .optional(),
    }),
  }),
  asyncHandler(async (req, res) => ok(res, await preferences.update(req.auth.userId, req.body)))
);

// ── Push devices ────────────────────────────────────────────────────────────

router.get("/push/config", asyncHandler(async (_req, res) => ok(res, push.config())));

router.get(
  "/devices",
  asyncHandler(async (req, res) => ok(res, await push.listForUser(req.auth.userId)))
);

router.post(
  "/devices",
  validate({
    body: z.object({
      kind: z.enum(["expo", "web"]),
      token: z.string().max(500).optional(),
      subscription: z
        .object({
          endpoint: z.string().url().max(2000),
          expirationTime: z.any().optional(),
          keys: z.object({ p256dh: z.string().max(300), auth: z.string().max(100) }),
        })
        .optional(),
      platform: z.enum(["ios", "android", "web", "unknown"]).optional(),
      deviceName: z.string().max(80).optional(),
      appVersion: z.string().max(30).optional(),
    }),
  }),
  asyncHandler(async (req, res) =>
    created(
      res,
      await push.register(req.auth.userId, {
        ...req.body,
        userAgent: req.headers["user-agent"],
      })
    )
  )
);

router.delete(
  "/devices",
  validate({ body: z.object({ token: z.string().max(2000) }) }),
  asyncHandler(async (req, res) => ok(res, await push.unregister(req.auth.userId, req.body.token)))
);

/** Sends a real push to the caller's own devices, so "is it working" is a button. */
router.post(
  "/devices/test",
  asyncHandler(async (req, res) => {
    const result = await push.sendToUser(req.auth.userId, {
      title: "Chefotech HRMS",
      body: "Push notifications are working on this device.",
      // The route comes from the template catalog so the deep-link suite
      // checks it, rather than being a second literal that could go stale.
      data: { actionUrl: notificationTemplates.TEMPLATES.announcement.actionUrl, category: "system" },
    });
    return ok(res, result);
  })
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
      body: z.string().max(10000).nullable().optional(),
      actionUrl: z.string().max(500).nullable().optional(),
      channels: z.array(z.enum(CHANNELS)).nullable().optional(),
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
    const template = await service.resolveTemplate(req.params.key);
    if (!template) throw AppError.notFound("Template");
    const organization = await tenant.runAsSystem(
      () => Organization.findById(tenant.requireOrganizationId()).lean(),
      "notification.preview"
    );

    const sample = {
      firstName: req.auth.firstName || "Ravi",
      employee: { id: "sample", name: "Ravi Kumar", firstName: "Ravi", department: "Operations", designation: "Supervisor" },
      approver: { name: req.auth.name },
      actor: { name: req.auth.name },
      leave: { type: "Casual Leave", from: "2026-09-01", to: "2026-09-03", days: 3, reason: "Family function", available: 2 },
      attendance: { date: "2026-09-04", checkIn: "09:47", lateBy: "32 minutes", shiftStart: "09:15", hours: 2 },
      period: { label: "August 2026" },
      run: { employeeCount: 42, netTotal: "₹18,40,000", exceptionsNote: "" },
      document: { name: "Passport", daysLeft: 7, expiresOn: "2026-09-11", status: "verified", category: "identity", note: "" },
      request: {
        type: "leave request",
        requesterName: "Ravi Kumar",
        // Read from the catalog so the deep-link suite checks it.
        url: notificationTemplates.TEMPLATES.leave_applied.actionUrl,
        label: "3 days",
        reasonNote: "",
      },
      ticket: { number: 42, subject: "Payslip shows wrong HRA", category: "Payroll", priority: "high", requester: "Ravi Kumar", preview: "My August HRA looks wrong.", status: "resolved", note: "" },
      claim: { amount: "₹4,200", title: "Client visit — taxi", status: "approved", note: "", date: "2026-09-01", days: 1 },
      asset: { name: "Dell Latitude 5440", tag: "LT-0042", dueDate: "2026-09-30", returnNote: "" },
      shift: { name: "General", startTime: "09:00", endTime: "18:00", from: "2026-09-08", to: "2026-09-14" },
      holiday: { name: "Gandhi Jayanti", date: "2026-10-02" },
      probation: { endsOn: "2026-09-30", when: "in 14 days" },
      confirmation: { date: "2026-10-01" },
      exit: { lastWorkingDay: "2026-10-31", type: "resignation" },
      movement: { effectiveFrom: "2026-10-01", summary: "the Bengaluru office", toDesignation: "Senior Supervisor" },
      salary: { effectiveFrom: "2026-10-01" },
      loan: { type: "salary advance", amount: "₹25,000", installments: 5, installmentAmount: "₹5,000", startPeriod: "October 2026", remaining: "₹20,000" },
      digest: { dateLabel: "Monday, 7 September", body: "WAITING ON YOU\n• 3 leave requests" },
      when: new Date().toLocaleString("en-GB"),
      ip: "203.0.113.14",
      device: "Chrome on Windows",
      years: 3,
      names: "Ravi Kumar, Meera Nair",
      title: "Office closed on Friday",
      message: "The office will be closed this Friday for maintenance.",
      company: { name: organization.name, ...(organization.branding || {}) },
      ...(req.body.data || {}),
    };

    return ok(res, {
      subject: notificationTemplates.render(template.subject, sample),
      title: notificationTemplates.render(template.title, sample),
      body: notificationTemplates.render(template.body, sample),
      actionUrl: template.actionUrl ? notificationTemplates.render(template.actionUrl, sample) : null,
      channels: template.channels,
      html: mailer.wrapHtml({
        title: notificationTemplates.render(template.title, sample),
        body: notificationTemplates.render(template.body, sample),
        branding: organization.branding || {},
        companyName: organization.name,
        actionUrl: template.actionUrl ? `${env.app.publicUrl}${notificationTemplates.render(template.actionUrl, sample)}` : null,
      }),
    });
  })
);

/** Send a template to the caller, rendered against sample data. */
router.post(
  "/templates/:key/send-test",
  requirePermission("notification.manage_templates"),
  validate({ params: z.object({ key: z.string().max(60) }) }),
  asyncHandler(async (req, res) => {
    const template = await service.resolveTemplate(req.params.key);
    if (!template) throw AppError.notFound("Template");
    const organization = await tenant.runAsSystem(
      () => Organization.findById(tenant.requireOrganizationId()).lean(),
      "notification.send-test"
    );
    const result = await service.notify({
      template: req.params.key,
      recipients: [{ userId: req.auth.userId, email: req.auth.email, firstName: req.auth.firstName, name: req.auth.name }],
      organization,
      data: {
        firstName: req.auth.firstName,
        employee: { id: req.auth.employeeId || "sample", name: req.auth.name, firstName: req.auth.firstName },
        title: "Test announcement",
        message: "This is a test of the announcement template.",
        period: { label: "Test period" },
      },
      channels: template.channels.filter((c) => c !== "sms"),
    });
    return ok(res, result);
  })
);

// ── Announcements ───────────────────────────────────────────────────────────

const AnnouncementSchema = z.object({
  title: z.string().trim().min(3).max(120),
  message: z.string().trim().min(3).max(8000),
  audience: z.enum(["all", "department", "location", "employees"]).default("all"),
  departmentId: objectId().optional(),
  locationId: objectId().optional(),
  employeeIds: z.array(objectId()).max(1000).optional(),
  channels: z.array(z.enum(["in_app", "email", "push"])).optional(),
  attachmentFileIds: z.array(objectId()).max(5).optional(),
  requireAcknowledgement: z.boolean().optional(),
  scheduledFor: z.string().datetime({ offset: true }).nullable().optional(),
  pinnedUntil: z.string().datetime({ offset: true }).nullable().optional(),
});

router.post(
  "/announce",
  requirePermission("notification.broadcast"),
  validate({ body: AnnouncementSchema }),
  asyncHandler(async (req, res) => created(res, await announcements.create(req.body, req)))
);

router.get(
  "/announcements",
  validate({ query: listQuery({ status: z.string().optional(), scope: z.enum(["mine", "manage"]).optional() }) }),
  asyncHandler(async (req, res) => {
    const adminView =
      req.query.scope !== "mine" && (req.auth.permissions || []).includes("notification.broadcast");
    const result = await announcements.list(req.query, req.auth, { adminView });
    return paged(res, result.items, result);
  })
);

router.get(
  "/announcements/:id",
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => ok(res, await announcements.get(req.params.id, req.auth)))
);

router.post(
  "/announcements/:id/acknowledge",
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => ok(res, await announcements.acknowledge(req.params.id, req.auth)))
);

router.get(
  "/announcements/:id/acknowledgements",
  requirePermission("notification.broadcast"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => ok(res, await announcements.acknowledgementReport(req.params.id)))
);

router.post(
  "/announcements/:id/remind",
  requirePermission("notification.broadcast"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => ok(res, await announcements.remind(req.params.id, req)))
);

router.post(
  "/announcements/:id/cancel",
  requirePermission("notification.broadcast"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => ok(res, await announcements.cancel(req.params.id, req)))
);

// ── Notification rules: "when this happens, tell these people" ──────────────

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
          group: notificationTemplates.groupOf(template.event),
          channels: template.channels || [],
          variables: notificationTemplates.variablesIn(template),
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
    ok(res, (await NotificationRule.find({}).sort({ event: 1, name: 1 }).lean()).map((r) => ({ ...r, id: String(r._id) })))
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
 * exactly as they wrote it, and only genuinely absent defaults are added.
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
    const createdRules = toCreate.length ? await NotificationRule.insertMany(toCreate) : [];

    await audit.record(
      {
        action: "notification.rules_seeded",
        entityType: "NotificationRule",
        after: { created: createdRules.length, skipped: skipped.length },
        severity: "notice",
      },
      req
    );

    return ok(res, { created: createdRules.length, skipped, alreadyPresent: rules.length - toCreate.length });
  })
);

// ── Mail: health, log, test, resend ─────────────────────────────────────────

/**
 * Is mail actually going to work?
 *
 * Mail can fail for three unrelated reasons that all look identical from a
 * user's seat — "I never got the email" — and each needs a different fix:
 * the switch is off, the credential is rejected, or the sender address is
 * not verified with the provider. This reports which.
 */
router.get(
  "/mail/health",
  requireAnyPermission("notification.manage_templates", "notification.view_mail_log"),
  asyncHandler(async (_req, res) => {
    const verify = env.mail.enabled
      ? await mailer.verify()
      : { ok: false, reason: "MAIL_ENABLED is not true — no mail will be sent" };

    return ok(res, {
      enabled: env.mail.enabled,
      driver: env.mail.driver,
      from: env.mail.from,
      replyTo: env.mail.replyTo || null,
      brevoKeySet: Boolean(env.mail.brevo.apiKey),
      smtpHostSet: Boolean(env.mail.host),
      reachable: verify.ok,
      reason: verify.reason || null,
      queue: env.jobs.enabled ? "background" : "inline",
      push: push.config(),
    });
  })
);

router.get(
  "/mail/log",
  requireAnyPermission("notification.manage_templates", "notification.view_mail_log"),
  validate({
    query: listQuery({
      status: z.enum(["queued", "sending", "sent", "failed", "simulated", "skipped"]).optional(),
      templateKey: z.string().max(60).optional(),
      to: z.string().max(120).optional(),
      fromDate: dateString().optional(),
      toDate: dateString().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await outbound.list(req.query);
    return paged(res, result.items, result);
  })
);

router.get(
  "/mail/stats",
  requireAnyPermission("notification.manage_templates", "notification.view_mail_log"),
  asyncHandler(async (_req, res) => ok(res, await outbound.stats()))
);

router.get(
  "/mail/log/:id",
  requireAnyPermission("notification.manage_templates", "notification.view_mail_log"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => ok(res, await outbound.get(req.params.id)))
);

router.post(
  "/mail/log/:id/resend",
  requirePermission("notification.manage_templates"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => {
    const result = await outbound.resend(req.params.id);
    await audit.record(
      { action: "notification.mail_resent", entityType: "MailMessage", entityId: req.params.id, severity: "notice" },
      req
    );
    return ok(res, result);
  })
);

/** Send a real test email to the caller — the fastest way to prove the pipe. */
router.post(
  "/mail/test",
  requirePermission("notification.manage_templates"),
  validate({ body: z.object({ to: z.string().email().optional() }) }),
  asyncHandler(async (req, res) => {
    const organization = await tenant.runAsSystem(
      () => Organization.findById(tenant.requireOrganizationId()).lean(),
      "notification.mail-test"
    );
    const to = req.body.to || req.auth.email;
    const result = await outbound.deliverEmail({
      to,
      toName: req.auth.name,
      subject: `Test email from ${organization.name} on Chefotech HRMS`,
      text: `Hi ${req.auth.firstName || ""},\n\nIf you can read this, outbound email from ${organization.name} is working.\n\nSent ${new Date().toLocaleString("en-GB")} via ${env.mail.driver}.`,
      html: mailer.wrapHtml({
        title: "Email is working",
        body: `Hi ${req.auth.firstName || ""},\n\nIf you can read this, outbound email from ${organization.name} is working.\n\nSent ${new Date().toLocaleString("en-GB")} via ${env.mail.driver}.`,
        branding: organization.branding || {},
        companyName: organization.name,
      }),
      templateKey: "mail_test",
      event: "notification.mail_test",
      recipientUserId: req.auth.userId,
    });
    await audit.record(
      { action: "notification.mail_test_sent", entityType: "MailMessage", entityLabel: to, severity: "info" },
      req
    );
    return ok(res, result);
  })
);

// ── Digest ──────────────────────────────────────────────────────────────────

router.get(
  "/digest/preview",
  asyncHandler(async (req, res) => ok(res, await digest.previewFor(req.auth)))
);

// ── Single notification actions (after every literal route) ─────────────────

router.post(
  "/:id/unread",
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => ok(res, await service.markUnread(req.auth.userId, req.params.id)))
);

router.delete(
  "/:id",
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => ok(res, await service.remove(req.auth.userId, req.params.id)))
);

module.exports = router;
