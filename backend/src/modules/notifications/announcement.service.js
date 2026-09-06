"use strict";

const Announcement = require("./announcement.model");
const Employee = require("../employees/employee.model");
const notifications = require("./notification.service");
const recipients = require("./recipients");
const audit = require("../../core/audit/audit.service");
const tenant = require("../../core/tenancy/tenantContext");
const { AppError } = require("../../core/errors/AppError");
const { logger } = require("../../config/logger");
const { parseListQuery } = require("../../core/http/queryOptions");

/**
 * Announcements: the noticeboard, scheduling, and read receipts.
 */

const ACTIVE = ["active", "on_leave", "notice_period"];

async function audienceEmployees(audience) {
  const filter = { status: { $in: ACTIVE } };
  if (audience.type === "department" && audience.departmentId) {
    filter["employment.departmentId"] = audience.departmentId;
  }
  if (audience.type === "location" && audience.locationId) {
    filter["employment.locationId"] = audience.locationId;
  }
  if (audience.type === "employees" && audience.employeeIds && audience.employeeIds.length) {
    filter._id = { $in: audience.employeeIds };
  }
  return Employee.find(filter)
    .select("userId personal.firstName personal.lastName personal.workEmail")
    .lean();
}

async function create(data, req) {
  const now = new Date();
  const scheduledFor = data.scheduledFor ? new Date(data.scheduledFor) : null;
  const sendNow = !scheduledFor || scheduledFor <= now;

  const announcement = await Announcement.create({
    title: data.title,
    message: data.message,
    audience: {
      type: data.audience || "all",
      departmentId: data.departmentId || null,
      locationId: data.locationId || null,
      employeeIds: data.employeeIds || [],
    },
    channels: data.channels && data.channels.length ? data.channels : ["in_app", "email"],
    attachmentFileIds: data.attachmentFileIds || [],
    requireAcknowledgement: Boolean(data.requireAcknowledgement),
    scheduledFor: sendNow ? null : scheduledFor,
    pinnedUntil: data.pinnedUntil ? new Date(data.pinnedUntil) : null,
    status: "scheduled",
    createdBy: tenant.getUserId(),
  });

  await audit.record(
    {
      action: sendNow ? "notification.announcement_sent" : "notification.announcement_scheduled",
      entityType: "Announcement",
      entityId: announcement._id,
      entityLabel: announcement.title,
      after: { audience: announcement.audience.type, scheduledFor, requireAcknowledgement: announcement.requireAcknowledgement },
      severity: "notice",
    },
    req
  );

  if (sendNow) return send(announcement._id);
  return shape(announcement.toObject());
}

/** Fan the announcement out. Idempotent: a sent one is never sent twice. */
async function send(announcementId) {
  const announcement = await Announcement.findOneAndUpdate(
    { _id: announcementId, status: { $in: ["scheduled", "failed"] } },
    { $set: { status: "sending" } },
    { new: true }
  );
  if (!announcement) {
    const existing = await Announcement.findById(announcementId).lean();
    if (!existing) throw AppError.notFound("Announcement");
    return shape(existing);
  }

  try {
    const employees = await audienceEmployees(announcement.audience);
    const organization = await recipients.organization();

    const outcome = await notifications.notify({
      template: "announcement",
      recipients: employees.map(recipients.employeeToRecipient),
      organization,
      data: {
        title: announcement.title,
        message: announcement.message,
        announcementId: String(announcement._id),
        requireAcknowledgement: announcement.requireAcknowledgement,
      },
      severity: "info",
      entity: { type: "Announcement", id: announcement._id },
      channels: announcement.channels,
    });

    announcement.status = "sent";
    announcement.sentAt = new Date();
    announcement.recipientCount = employees.length;
    announcement.delivery = outcome;
    announcement.error = null;
    await announcement.save();
  } catch (err) {
    logger.error({ err, announcementId: String(announcement._id) }, "Announcement send failed");
    announcement.status = "failed";
    announcement.error = err.message;
    await announcement.save();
    throw err;
  }

  return shape(announcement.toObject());
}

/** The scheduler's entry point: send whatever is due in this tenant. */
async function sendDue() {
  const due = await Announcement.find({ status: "scheduled", scheduledFor: { $ne: null, $lte: new Date() } })
    .select("_id")
    .lean();
  let sent = 0;
  for (const row of due) {
    try {
      await send(row._id);
      sent += 1;
    } catch {
      // Recorded on the announcement itself; the loop continues.
    }
  }
  return { due: due.length, sent };
}

async function cancel(announcementId, req) {
  const announcement = await Announcement.findById(announcementId);
  if (!announcement) throw AppError.notFound("Announcement");
  if (announcement.status !== "scheduled") {
    throw AppError.conflict("Only a scheduled announcement can be cancelled.");
  }
  announcement.status = "cancelled";
  await announcement.save();

  await audit.record(
    { action: "notification.announcement_cancelled", entityType: "Announcement", entityId: announcement._id, entityLabel: announcement.title, severity: "notice" },
    req
  );
  return shape(announcement.toObject());
}

async function acknowledge(announcementId, auth) {
  const announcement = await Announcement.findById(announcementId);
  if (!announcement) throw AppError.notFound("Announcement");
  if (announcement.status !== "sent") throw AppError.conflict("This announcement has not been sent.");

  const already = announcement.acknowledgements.some((a) => String(a.userId) === String(auth.userId));
  if (!already) {
    announcement.acknowledgements.push({
      userId: auth.userId,
      employeeId: auth.employeeId || null,
      at: new Date(),
    });
    await announcement.save();
  }
  return { acknowledged: true, at: new Date() };
}

/** Admin list: everything, newest first. Employee list: sent only. */
async function list(query = {}, auth, { adminView = false } = {}) {
  const { page, limit, skip } = parseListQuery(query, { allowedSort: ["createdAt"], maxLimit: 100 });
  const filter = adminView ? {} : { status: "sent" };
  if (query.status && adminView) filter.status = query.status;

  const [items, total] = await Promise.all([
    Announcement.find(filter)
      .sort({ pinnedUntil: -1, sentAt: -1, scheduledFor: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("createdBy", "firstName lastName")
      .lean(),
    Announcement.countDocuments(filter),
  ]);

  return {
    items: items.map((a) => shape(a, auth)),
    page,
    limit,
    total,
  };
}

async function get(announcementId, auth) {
  const announcement = await Announcement.findById(announcementId)
    .populate("createdBy", "firstName lastName")
    .lean();
  if (!announcement) throw AppError.notFound("Announcement");
  return shape(announcement, auth);
}

/** Who has and has not acknowledged — the report HR is asked for. */
async function acknowledgementReport(announcementId) {
  const announcement = await Announcement.findById(announcementId).lean();
  if (!announcement) throw AppError.notFound("Announcement");

  const employees = await audienceEmployees(announcement.audience);
  const acked = new Set(announcement.acknowledgements.map((a) => String(a.userId)));
  const ackedAt = Object.fromEntries(announcement.acknowledgements.map((a) => [String(a.userId), a.at]));

  const rows = employees.map((e) => ({
    employeeId: String(e._id),
    name: [e.personal.firstName, e.personal.lastName].filter(Boolean).join(" "),
    email: e.personal.workEmail,
    hasAccount: Boolean(e.userId),
    acknowledged: Boolean(e.userId && acked.has(String(e.userId))),
    acknowledgedAt: e.userId ? ackedAt[String(e.userId)] || null : null,
  }));

  return {
    total: rows.length,
    acknowledged: rows.filter((r) => r.acknowledged).length,
    pending: rows.filter((r) => !r.acknowledged),
    rows,
  };
}

/** Nudge everyone who has not acknowledged yet. */
async function remind(announcementId, req) {
  const announcement = await Announcement.findById(announcementId).lean();
  if (!announcement) throw AppError.notFound("Announcement");
  if (!announcement.requireAcknowledgement) {
    throw AppError.badRequest("This announcement does not ask for acknowledgement.");
  }

  const report = await acknowledgementReport(announcementId);
  const pendingIds = report.pending.map((r) => r.employeeId);
  if (!pendingIds.length) return { reminded: 0 };

  const organization = await recipients.organization();
  const outcome = await notifications.notify({
    template: "announcement",
    recipients: await recipients.employees(pendingIds),
    organization,
    data: {
      title: `Reminder: ${announcement.title}`,
      message: announcement.message,
      announcementId: String(announcement._id),
      requireAcknowledgement: true,
    },
    entity: { type: "Announcement", id: announcement._id },
    channels: ["in_app", "push"],
  });

  await audit.record(
    { action: "notification.announcement_reminded", entityType: "Announcement", entityId: announcement._id, entityLabel: announcement.title, after: { reminded: outcome.sent }, severity: "notice" },
    req
  );
  return { reminded: outcome.sent };
}

function shape(a, auth) {
  const out = {
    id: String(a._id),
    title: a.title,
    message: a.message,
    audience: a.audience,
    channels: a.channels,
    attachmentFileIds: (a.attachmentFileIds || []).map(String),
    requireAcknowledgement: a.requireAcknowledgement,
    scheduledFor: a.scheduledFor,
    status: a.status,
    sentAt: a.sentAt,
    recipientCount: a.recipientCount,
    acknowledgedCount: (a.acknowledgements || []).length,
    pinnedUntil: a.pinnedUntil,
    error: a.error,
    createdAt: a.createdAt,
    createdBy: a.createdBy && a.createdBy.firstName
      ? [a.createdBy.firstName, a.createdBy.lastName].filter(Boolean).join(" ")
      : null,
  };
  if (auth) {
    const mine = (a.acknowledgements || []).find((x) => String(x.userId) === String(auth.userId));
    out.acknowledged = Boolean(mine);
    out.acknowledgedAt = mine ? mine.at : null;
  }
  return out;
}

module.exports = { create, send, sendDue, cancel, acknowledge, list, get, acknowledgementReport, remind, Announcement };
