"use strict";

const mongoose = require("mongoose");
const Notification = require("./notification.model");
const EmailTemplate = require("./emailTemplate.model");
const templates = require("./notificationTemplates");
const ruleService = require("./notificationRule.service");
const preferences = require("./preference.service");
const outbound = require("./outbound.service");
const push = require("./push.service");
const mailer = require("./mailer");
const eventBus = require("../../core/events/eventBus");
const queue = require("../../core/jobs/queue");
const settings = require("../../core/settings/settings.service");
const tenant = require("../../core/tenancy/tenantContext");
const { env } = require("../../config/env");
const { logger } = require("../../config/logger");
const { AppError } = require("../../core/errors/AppError");
const { parseListQuery } = require("../../core/http/queryOptions");

/**
 * Notification delivery.
 *
 * One entry point — `notify()` — takes an event and a set of recipients, and
 * the channel routing is decided by configuration: the template's channels,
 * intersected with the organization's enabled channels, then filtered by each
 * person's own preferences. A module that wants to tell someone something
 * never talks to SMTP, the push service or the socket layer directly.
 *
 * What changed from the first version, and why:
 *
 *   Email and push are handed to the job queue rather than sent inline, so a
 *   broadcast to four hundred people returns in milliseconds and a provider
 *   hiccup is retried instead of lost.
 *
 *   The per-channel outcome is written back onto the Notification. The model
 *   always had a `delivery` map for this; the old code built one in a local
 *   variable and threw it away, so a failed email was invisible.
 *
 *   `sent` counts people who were reached on at least one channel. It used to
 *   count in-app writes only, so an email-only template reported zero sends
 *   even when every email went.
 *
 *   A rule that names a template now actually changes the template. The rule
 *   service returned `templateKey` and nothing read it.
 */

const CATEGORY_BY_PREFIX = {
  leave: "leave",
  attendance: "attendance",
  shift: "attendance",
  holiday: "attendance",
  payroll: "payroll",
  expense: "expense",
  document: "document",
  workflow: "workflow",
  employee: "employee",
  account: "system",
  notification: "system",
  announcement: "announcement",
  ticket: "ticket",
  asset: "asset",
  request: "workflow",
  loan: "payroll",
  onboarding: "employee",
  exit: "employee",
  performance: "employee",
  survey: "announcement",
};

let realtime = null;
/** Wired by the socket layer at boot; absent in tests and workers. */
function setRealtime(emitter) {
  realtime = emitter;
}

function categoryFor(event) {
  return CATEGORY_BY_PREFIX[String(event).split(".")[0]] || "system";
}

async function resolveTemplate(templateKey) {
  const builtin = templates.TEMPLATES[templateKey];
  if (!builtin) throw AppError.badRequest(`Unknown notification template '${templateKey}'`);

  let override = null;
  if (tenant.getOrganizationId()) {
    override = await EmailTemplate.findOne({ templateKey }).lean().catch(() => null);
  }

  if (override && override.enabled === false) return null; // tenant switched it off

  return {
    key: templateKey,
    event: builtin.event,
    channels: (override && override.channels) || builtin.channels,
    subject: (override && override.subject) || builtin.subject,
    title: (override && override.title) || builtin.title,
    body: (override && override.body) || builtin.body,
    actionUrl: (override && override.actionUrl) || builtin.actionUrl,
    isHtml: Boolean(override && override.isHtml),
  };
}

async function loadOrganization() {
  const Organization = require("../organizations/organization.model");
  const id = tenant.getOrganizationId();
  if (!id) return null;
  return tenant.runAsSystem(() => Organization.findById(id).lean(), "notification.organization");
}

function absolute(url) {
  if (!url) return "";
  if (/^https?:\/\//.test(url)) return url;
  return `${env.app.publicUrl}${url.startsWith("/") ? "" : "/"}${url}`;
}

/** Push goes through the queue for the same reason email does. */
async function dispatchPush(userId, message) {
  if (env.jobs.enabled && !env.isTest) {
    await queue.enqueue("push.send", { userId: String(userId), message }, { priority: 4 });
    return { queued: true };
  }
  try {
    return await push.sendToUser(userId, message);
  } catch (err) {
    logger.warn({ err, userId: String(userId) }, "Push send failed");
    return { attempted: 0, delivered: 0, failed: 1, error: err.message };
  }
}

/**
 * Send a notification.
 *
 * @param {object} params
 * @param {string} params.template       key from notificationTemplates
 * @param {Array}  params.recipients     [{ userId, email, employeeId, firstName }]
 * @param {object} params.data           placeholder values
 * @param {object} [params.organization] for branding in emails; loaded if absent
 * @param {string} [params.severity]
 * @param {object} [params.entity]       { type, id }
 * @param {Array}  [params.channels]     override the template's channels
 * @returns {Promise<{sent:number, skipped:number, recipients:number, channels:object}>}
 */
async function notify({
  template: templateKey,
  recipients = [],
  data = {},
  organization = null,
  severity = "info",
  entity = null,
  channels: channelOverride = null,
}) {
  const empty = { sent: 0, skipped: 0, recipients: 0, channels: { in_app: 0, email: 0, push: 0 } };
  if (!recipients.length) return empty;

  let template = await resolveTemplate(templateKey);
  if (!template) return { ...empty, skipped: recipients.length, recipients: recipients.length };

  /**
   * The tenant's own rules, applied on top of whoever the caller named.
   *
   * Strictly additive for recipients: `mergeRecipients` puts the caller's list
   * first and dedupes, so a rule can copy the plant manager on every rejection
   * but can never stop the employee hearing about their own.
   */
  const rules = await ruleService.extraRecipientsFor(template.event, {
    subject: recipients[0] || null,
    actor: data.actor || null,
    data,
  });

  if (rules.templateKey && rules.templateKey !== templateKey) {
    const swapped = await resolveTemplate(rules.templateKey).catch(() => null);
    if (swapped) template = swapped;
  }

  const audience = ruleService.mergeRecipients(recipients, rules.recipients);

  const enabled = await settings
    .get("notification.channels_enabled")
    .catch(() => ["in_app", "email"]);

  const channels = (channelOverride || rules.channels || template.channels).filter((c) =>
    enabled.includes(c)
  );
  if (!channels.length) return { ...empty, skipped: audience.length, recipients: audience.length };

  const org = organization || (await loadOrganization().catch(() => null));
  const timezone = (org && org.timezone) || undefined;
  const category = categoryFor(template.event);

  const prefs = await preferences.forUsers(audience.map((r) => r.userId)).catch(() => new Map());

  const outcome = {
    sent: 0,
    skipped: 0,
    recipients: audience.length,
    channels: { in_app: 0, email: 0, push: 0 },
  };
  const notificationIds = [];

  for (const recipient of audience) {
    const payload = {
      ...data,
      recipient,
      firstName: recipient.firstName || data.firstName || "",
      company: org ? { name: org.name, ...(org.branding || {}) } : data.company || {},
    };

    const rendered = {
      subject: templates.render(template.subject, payload),
      title: templates.render(template.title, payload),
      body: templates.render(template.body, payload),
      actionUrl: template.actionUrl ? templates.render(template.actionUrl, payload) : null,
    };

    const pref = recipient.userId ? prefs.get(String(recipient.userId)) : null;
    const wanted = channels.filter((c) => preferences.allows(pref, c, category, { timezone }));

    const delivery = {};
    let doc = null;
    let reached = false;

    // ── In-app ────────────────────────────────────────────────────────────
    if (wanted.includes("in_app") && recipient.userId) {
      try {
        doc = await Notification.create({
          recipientUserId: recipient.userId,
          recipientEmployeeId: recipient.employeeId || null,
          templateKey: template.key,
          event: template.event,
          title: rendered.title,
          body: rendered.body,
          actionUrl: rendered.actionUrl,
          severity,
          category,
          entityType: entity && entity.type,
          entityId: entity && entity.id,
          delivery: { in_app: { status: "sent", at: new Date() } },
        });
        notificationIds.push(doc._id);
        delivery.in_app = { status: "sent", at: new Date() };
        reached = true;
        outcome.channels.in_app += 1;

        if (realtime) {
          realtime.toUser(String(recipient.userId), "notification", {
            id: String(doc._id),
            title: doc.title,
            body: doc.body,
            actionUrl: doc.actionUrl,
            severity: doc.severity,
            category: doc.category,
            createdAt: doc.createdAt,
          });
        }
      } catch (err) {
        logger.error({ err, templateKey }, "In-app notification failed");
        delivery.in_app = { status: "failed", at: new Date(), error: err.message };
      }
    }

    // ── Email ─────────────────────────────────────────────────────────────
    if (wanted.includes("email") && recipient.email) {
      try {
        const link = rendered.actionUrl ? absolute(rendered.actionUrl) : null;
        const result = await outbound.deliverEmail({
          to: recipient.email,
          toName: recipient.name || recipient.firstName || "",
          subject: rendered.subject || rendered.title,
          text: rendered.body + (link ? `\n\n${link}` : ""),
          html: template.isHtml
            ? rendered.body
            : mailer.wrapHtml({
                title: rendered.title,
                body: rendered.body,
                branding: (org && org.branding) || {},
                companyName: org && org.name,
                actionUrl: link,
                actionLabel: "Open in Chefotech HRMS",
              }),
          templateKey: template.key,
          event: template.event,
          notificationId: doc ? doc._id : null,
          recipientUserId: recipient.userId || null,
          organizationId: org ? org._id : tenant.getOrganizationId() || null,
        });

        const failed = !result.queued && result.delivered === false && !result.simulated;
        delivery.email = {
          status: result.queued ? "queued" : failed ? "failed" : "sent",
          at: new Date(),
          ...(result.error ? { error: String(result.error).slice(0, 300) } : {}),
          ...(result.messageId ? { messageId: result.messageId } : {}),
        };
        if (!failed) {
          reached = true;
          outcome.channels.email += 1;
        }
      } catch (err) {
        logger.error({ err, to: recipient.email, templateKey }, "Notification email failed");
        delivery.email = { status: "failed", at: new Date(), error: err.message };
      }
    }

    // ── Push ──────────────────────────────────────────────────────────────
    if (wanted.includes("push") && recipient.userId) {
      const result = await dispatchPush(recipient.userId, {
        title: rendered.title,
        body: rendered.body.slice(0, 240),
        data: {
          notificationId: doc ? String(doc._id) : null,
          actionUrl: rendered.actionUrl,
          category,
          event: template.event,
        },
      });
      const status = result.queued
        ? "queued"
        : result.noDevices
          ? "skipped"
          : result.delivered > 0
            ? "sent"
            : "failed";
      delivery.push = { status, at: new Date(), ...(result.error ? { error: result.error } : {}) };
      if (status === "queued" || status === "sent") {
        reached = true;
        outcome.channels.push += 1;
      }
    }

    if (doc && Object.keys(delivery).length > 1) {
      await Notification.updateOne({ _id: doc._id }, { $set: { delivery } }).catch(() => {});
    }

    if (reached) outcome.sent += 1;
    else outcome.skipped += 1;
  }

  // Anything else that cares — webhooks, integrations — hears about it here.
  eventBus
    .emit(template.event, {
      templateKey: template.key,
      organizationId: org ? String(org._id) : tenant.getOrganizationId(),
      recipients: audience.length,
      data: stripActor(data),
      entity: entity ? { type: entity.type, id: entity.id ? String(entity.id) : null } : null,
      outcome,
    })
    .catch(() => {});

  return { ...outcome, notificationIds: notificationIds.map(String) };
}

function stripActor(data) {
  if (!data || typeof data !== "object") return data;
  const { actor, ...rest } = data;
  return actor ? { ...rest, actor: { name: actor.name || null } } : rest;
}

/**
 * Send a template to a bare email address, outside any tenant context.
 * Used by the auth flows (welcome, reset, invitation) where the recipient may
 * not have a membership yet. Goes through the same outbound log and queue.
 */
async function sendTransactional({ to, template: templateKey, data = {}, organizationId = null }) {
  const builtin = templates.TEMPLATES[templateKey];
  if (!builtin) throw AppError.badRequest(`Unknown template '${templateKey}'`);

  let organization = null;
  if (organizationId) {
    const Organization = require("../organizations/organization.model");
    organization = await Organization.findById(organizationId).lean().catch(() => null);
  }

  const payload = {
    ...data,
    company: organization ? { name: organization.name, ...(organization.branding || {}) } : {},
  };

  const link = builtin.actionUrl ? absolute(templates.render(builtin.actionUrl, payload)) : null;

  return outbound.deliverEmail({
    to,
    toName: data.firstName || "",
    subject: templates.render(builtin.subject, payload),
    text: templates.render(builtin.body, payload),
    html: mailer.wrapHtml({
      title: templates.render(builtin.title, payload),
      body: templates.render(builtin.body, payload),
      branding: (organization && organization.branding) || {},
      companyName: organization && organization.name,
      actionUrl: link,
    }),
    templateKey,
    event: builtin.event,
    organizationId: organizationId || null,
  });
}

// ── Reads for the notification centre ───────────────────────────────────────

async function listForUser(userId, query = {}) {
  const { page, limit, skip } = parseListQuery(query, {
    allowedSort: ["createdAt"],
    maxLimit: 100,
  });

  const filter = { recipientUserId: userId };
  if (query.unreadOnly === "true" || query.unreadOnly === true) filter.readAt = null;
  if (query.category) filter.category = query.category;
  if (query.q) {
    const safe = String(query.q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [{ title: { $regex: safe, $options: "i" } }, { body: { $regex: safe, $options: "i" } }];
  }

  const [items, total, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ recipientUserId: userId, readAt: null }),
  ]);

  return { items: items.map((n) => ({ ...n, id: String(n._id) })), page, limit, total, unread };
}

async function markRead(userId, notificationIds) {
  const filter = { recipientUserId: userId, readAt: null };
  if (notificationIds && notificationIds.length) {
    filter._id = { $in: notificationIds.map((id) => new mongoose.Types.ObjectId(id)) };
  }
  const result = await Notification.updateMany(filter, { $set: { readAt: new Date() } });
  return { updated: result.modifiedCount };
}

async function markUnread(userId, notificationId) {
  const result = await Notification.updateOne(
    { _id: notificationId, recipientUserId: userId },
    { $set: { readAt: null } }
  );
  return { updated: result.modifiedCount };
}

async function remove(userId, notificationId) {
  const result = await Notification.deleteOne({ _id: notificationId, recipientUserId: userId });
  return { deleted: result.deletedCount > 0 };
}

async function clearRead(userId) {
  const result = await Notification.deleteMany({ recipientUserId: userId, readAt: { $ne: null } });
  return { deleted: result.deletedCount };
}

async function unreadCount(userId) {
  return Notification.countDocuments({ recipientUserId: userId, readAt: null });
}

/** Unread counts by category, for the notification centre tabs. */
async function summaryForUser(userId) {
  const rows = await Notification.aggregate([
    { $match: { organizationId: new mongoose.Types.ObjectId(tenant.requireOrganizationId()), recipientUserId: new mongoose.Types.ObjectId(String(userId)) } },
    { $group: { _id: "$category", total: { $sum: 1 }, unread: { $sum: { $cond: [{ $eq: ["$readAt", null] }, 1, 0] } } } },
  ]);
  return rows.map((r) => ({ category: r._id, total: r.total, unread: r.unread }));
}

/** Template management for the settings screen. */
async function listTemplates() {
  const overrides = await EmailTemplate.find({}).lean();
  const byKey = Object.fromEntries(overrides.map((o) => [o.templateKey, o]));

  return templates.TEMPLATE_KEYS.map((key) => {
    const builtin = templates.TEMPLATES[key];
    const override = byKey[key];
    return {
      key,
      event: builtin.event,
      group: templates.groupOf(builtin.event),
      category: categoryFor(builtin.event),
      channels: (override && override.channels) || builtin.channels,
      subject: (override && override.subject) || builtin.subject,
      title: (override && override.title) || builtin.title,
      body: (override && override.body) || builtin.body,
      actionUrl: (override && override.actionUrl) || builtin.actionUrl || null,
      enabled: override ? override.enabled : true,
      isHtml: Boolean(override && override.isHtml),
      isCustomised: Boolean(override),
      variables: templates.variablesIn(builtin),
      defaults: {
        subject: builtin.subject,
        title: builtin.title,
        body: builtin.body,
        channels: builtin.channels,
      },
    };
  });
}

async function updateTemplate(templateKey, patch) {
  if (!templates.TEMPLATES[templateKey]) {
    throw AppError.badRequest(`Unknown template '${templateKey}'`);
  }
  const doc = await EmailTemplate.findOneAndUpdate(
    { templateKey },
    { $set: { ...patch, templateKey } },
    { upsert: true, new: true }
  );
  return doc;
}

async function resetTemplate(templateKey) {
  await EmailTemplate.deleteOne({ templateKey });
  return { reset: true };
}

module.exports = {
  notify,
  sendTransactional,
  listForUser,
  markRead,
  markUnread,
  remove,
  clearRead,
  unreadCount,
  summaryForUser,
  listTemplates,
  updateTemplate,
  resetTemplate,
  setRealtime,
  resolveTemplate,
  categoryFor,
  Notification,
};
