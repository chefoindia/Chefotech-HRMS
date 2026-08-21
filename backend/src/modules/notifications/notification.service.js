"use strict";

const mongoose = require("mongoose");
const Notification = require("./notification.model");
const EmailTemplate = require("./emailTemplate.model");
const templates = require("./notificationTemplates");
const mailer = require("./mailer");
const settings = require("../../core/settings/settings.service");
const tenant = require("../../core/tenancy/tenantContext");
const { logger } = require("../../config/logger");
const { AppError } = require("../../core/errors/AppError");
const { parseListQuery } = require("../../core/http/queryOptions");

/**
 * Notification delivery.
 *
 * One entry point — `notify()` — takes an event and a set of recipients, and
 * the channel routing is decided by configuration: the template's channels,
 * intersected with the organization's enabled channels. A module that wants to
 * tell someone something never talks to SMTP or the socket layer directly.
 */

const CATEGORY_BY_PREFIX = {
  leave: "leave",
  attendance: "attendance",
  payroll: "payroll",
  document: "document",
  workflow: "workflow",
  employee: "employee",
  account: "system",
  announcement: "announcement",
};

let realtime = null;
/** Wired by the socket layer at boot; absent in tests and workers. */
function setRealtime(emitter) {
  realtime = emitter;
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

/**
 * Send a notification.
 *
 * @param {object} params
 * @param {string} params.template       key from notificationTemplates
 * @param {Array}  params.recipients     [{ userId, email, employeeId, firstName }]
 * @param {object} params.data           placeholder values
 * @param {object} [params.organization] for branding in emails
 * @param {string} [params.severity]
 * @param {object} [params.entity]       { type, id }
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
  if (!recipients.length) return { sent: 0, skipped: 0 };

  const template = await resolveTemplate(templateKey);
  if (!template) return { sent: 0, skipped: recipients.length };

  const enabled = await settings
    .get("notification.channels_enabled")
    .catch(() => ["in_app", "email"]);

  const channels = (channelOverride || template.channels).filter((c) => enabled.includes(c));
  if (!channels.length) return { sent: 0, skipped: recipients.length };

  const category = CATEGORY_BY_PREFIX[String(template.event).split(".")[0]] || "system";
  let sent = 0;

  for (const recipient of recipients) {
    const payload = {
      ...data,
      recipient,
      firstName: recipient.firstName || data.firstName || "",
      company: organization
        ? { name: organization.name, ...(organization.branding || {}) }
        : data.company || {},
    };

    const rendered = {
      subject: templates.render(template.subject, payload),
      title: templates.render(template.title, payload),
      body: templates.render(template.body, payload),
      actionUrl: template.actionUrl ? templates.render(template.actionUrl, payload) : null,
    };

    const delivery = {};

    // ── In-app ────────────────────────────────────────────────────────────
    if (channels.includes("in_app") && recipient.userId) {
      try {
        const doc = await Notification.create({
          recipientUserId: recipient.userId,
          recipientEmployeeId: recipient.employeeId || null,
          templateKey,
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
        delivery.in_app = "sent";
        sent += 1;
      } catch (err) {
        logger.error({ err, templateKey }, "In-app notification failed");
        delivery.in_app = "failed";
      }
    }

    // ── Email ─────────────────────────────────────────────────────────────
    if (channels.includes("email") && recipient.email) {
      try {
        await mailer.send({
          to: recipient.email,
          subject: rendered.subject || rendered.title,
          text: rendered.body + (rendered.actionUrl ? `\n\n${absolute(rendered.actionUrl)}` : ""),
          html: template.isHtml
            ? rendered.body
            : mailer.wrapHtml({
                title: rendered.title,
                body: rendered.body + (rendered.actionUrl ? `\n\n${absolute(rendered.actionUrl)}` : ""),
                branding: (organization && organization.branding) || {},
                companyName: organization && organization.name,
              }),
        });
        delivery.email = "sent";
      } catch (err) {
        logger.error({ err, to: recipient.email, templateKey }, "Notification email failed");
        delivery.email = "failed";
      }
    }
  }

  return { sent, skipped: recipients.length - sent };
}

function absolute(url) {
  if (!url) return "";
  if (/^https?:\/\//.test(url)) return url;
  const { env } = require("../../config/env");
  return `${env.app.publicUrl}${url.startsWith("/") ? "" : "/"}${url}`;
}

/**
 * Send a template to a bare email address, outside any tenant context.
 * Used by the auth flows (welcome, reset, invitation) where the recipient may
 * not have a membership yet.
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

  return mailer.send({
    to,
    subject: templates.render(builtin.subject, payload),
    text: templates.render(builtin.body, payload),
    html: mailer.wrapHtml({
      title: templates.render(builtin.title, payload),
      body: templates.render(builtin.body, payload),
      branding: (organization && organization.branding) || {},
      companyName: organization && organization.name,
    }),
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

  const [items, total, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ recipientUserId: userId, readAt: null }),
  ]);

  return { items, page, limit, total, unread };
}

async function markRead(userId, notificationIds) {
  const filter = { recipientUserId: userId, readAt: null };
  if (notificationIds && notificationIds.length) {
    filter._id = { $in: notificationIds.map((id) => new mongoose.Types.ObjectId(id)) };
  }
  const result = await Notification.updateMany(filter, { $set: { readAt: new Date() } });
  return { updated: result.modifiedCount };
}

async function unreadCount(userId) {
  return Notification.countDocuments({ recipientUserId: userId, readAt: null });
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
      channels: (override && override.channels) || builtin.channels,
      subject: (override && override.subject) || builtin.subject,
      title: (override && override.title) || builtin.title,
      body: (override && override.body) || builtin.body,
      enabled: override ? override.enabled : true,
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
  unreadCount,
  listTemplates,
  updateTemplate,
  resetTemplate,
  setRealtime,
  resolveTemplate,
  Notification,
};
