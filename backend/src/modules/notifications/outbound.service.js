"use strict";

const mongoose = require("mongoose");
const MailMessage = require("./mailMessage.model");
const mailer = require("./mailer");
const queue = require("../../core/jobs/queue");
const { env } = require("../../config/env");
const { logger } = require("../../config/logger");
const { AppError } = require("../../core/errors/AppError");
const tenant = require("../../core/tenancy/tenantContext");
const { parseListQuery } = require("../../core/http/queryOptions");

/**
 * Outbound email, as a durable queue rather than an inline HTTP call.
 *
 * Before this, `notify()` called the mail provider once per recipient, in
 * sequence, inside the HTTP request that raised the event. An announcement to
 * four hundred people was four hundred serial API calls before the admin got
 * a response — which is to say a timeout, the provider's rate limiter, and no
 * record of which of the four hundred actually went. A transient provider
 * error on a password reset lost that reset for good.
 *
 * Every send now writes a MailMessage and, when the job worker is running,
 * hands delivery to a `mail.send` job with the queue's retry and backoff. The
 * caller gets back "queued" in milliseconds. In tests and in a process with
 * jobs disabled the send happens inline instead, so behaviour is identical
 * from the caller's point of view — only the latency differs.
 */

const PREVIEW_LENGTH = 4000;

function useQueue() {
  return env.jobs.enabled && !env.isTest;
}

/**
 * Ask for an email to be sent.
 *
 * @returns {Promise<{messageId: string, queued: boolean, delivered?: boolean, simulated?: boolean, error?: string}>}
 */
async function deliverEmail({
  to,
  toName = "",
  subject,
  text,
  html,
  replyTo = null,
  templateKey = null,
  event = null,
  notificationId = null,
  recipientUserId = null,
  organizationId,
  meta = {},
  resendOf = null,
}) {
  if (!to) throw AppError.badRequest("An email needs a recipient.");

  const orgId =
    organizationId !== undefined ? organizationId : tenant.getOrganizationId() || null;

  const message = await MailMessage.create({
    organizationId: orgId,
    to: String(to).trim(),
    toName,
    replyTo: replyTo || env.mail.replyTo || null,
    subject: subject || "(no subject)",
    text: String(text || "").slice(0, 200_000),
    html: String(html || "").slice(0, 400_000),
    templateKey,
    event,
    notificationId,
    recipientUserId,
    status: "queued",
    meta,
    resendOf,
  });

  if (useQueue()) {
    const job = await queue.enqueue(
      "mail.send",
      { messageId: String(message._id) },
      { organizationId: orgId, priority: 3 }
    );
    await MailMessage.updateOne({ _id: message._id }, { $set: { jobId: job._id } });
    return { messageId: String(message._id), queued: true };
  }

  const outcome = await sendNow(String(message._id), { rethrow: false });
  return { messageId: String(message._id), queued: false, ...outcome };
}

/**
 * Perform the send for one recorded message. Called by the job worker and,
 * when the queue is off, directly by deliverEmail().
 *
 * `rethrow` is what turns a provider failure into a job retry: the worker
 * wants the exception so it can back off and try again; an inline caller
 * wants the outcome recorded and returned.
 */
async function sendNow(messageId, { rethrow = true } = {}) {
  const message = await MailMessage.findById(messageId);
  if (!message) throw AppError.notFound("Mail message");
  if (message.status === "sent") return { delivered: true, alreadySent: true };

  message.status = "sending";
  message.attempts += 1;
  message.lastAttemptAt = new Date();
  await message.save();

  try {
    // Attachments are referenced by stored-file id and read at send time, so
    // a retry days later still carries the same file and Mongo never holds
    // the bytes twice.
    const attachments = await loadAttachments(message.meta && message.meta.attachmentFileIds);

    const result = await mailer.send({
      to: message.toName ? `${message.toName} <${message.to}>` : message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      replyTo: message.replyTo || undefined,
      attachments,
    });

    message.status = result.simulated ? "simulated" : "sent";
    message.provider = result.simulated ? "outbox" : env.mail.driver;
    message.providerMessageId = result.messageId || null;
    message.sentAt = new Date();
    message.error = null;
    await message.save();

    return { delivered: Boolean(result.delivered), simulated: Boolean(result.simulated) };
  } catch (err) {
    const reason = err && err.message ? err.message : String(err);
    message.status = "failed";
    message.error = reason.slice(0, 1000);
    await message.save();

    logger.warn({ messageId: String(message._id), to: message.to, reason }, "Email send failed");
    if (rethrow) throw err;
    return { delivered: false, error: reason };
  }
}

async function loadAttachments(fileIds) {
  if (!fileIds || !fileIds.length) return [];
  const storage = require("../../core/storage/storage.service");
  const out = [];
  for (const id of fileIds.slice(0, 5)) {
    try {
      const file = await storage.StoredFile.findById(id).lean();
      if (!file) continue;
      const { stream } = await storage.openStream(file);
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      out.push({ filename: file.originalName || file.fileName || "attachment", content: Buffer.concat(chunks), contentType: file.mimeType });
    } catch (err) {
      logger.warn({ err, fileId: String(id) }, "Could not attach a file to an email");
    }
  }
  return out;
}

/** Replay a message as a fresh row, so the original's history is kept. */
async function resend(messageId) {
  const original = await MailMessage.findOne({
    _id: messageId,
    organizationId: tenant.requireOrganizationId(),
  }).lean();
  if (!original) throw AppError.notFound("Mail message");

  return deliverEmail({
    to: original.to,
    toName: original.toName,
    subject: original.subject,
    text: original.text,
    html: original.html,
    replyTo: original.replyTo,
    templateKey: original.templateKey,
    event: original.event,
    notificationId: original.notificationId,
    recipientUserId: original.recipientUserId,
    organizationId: original.organizationId,
    meta: original.meta,
    resendOf: original._id,
  });
}

/** The tenant's own outbound log, newest first. */
async function list(query = {}) {
  const { page, limit, skip } = parseListQuery(query, { allowedSort: ["createdAt"], maxLimit: 100 });
  const filter = { organizationId: tenant.requireOrganizationId() };

  if (query.status) filter.status = query.status;
  if (query.templateKey) filter.templateKey = query.templateKey;
  if (query.to) {
    filter.to = { $regex: String(query.to).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
  }
  if (query.fromDate) {
    filter.createdAt = { ...(filter.createdAt || {}), $gte: new Date(`${query.fromDate}T00:00:00Z`) };
  }
  if (query.toDate) {
    filter.createdAt = { ...(filter.createdAt || {}), $lte: new Date(`${query.toDate}T23:59:59Z`) };
  }

  const [items, total] = await Promise.all([
    MailMessage.find(filter).select("-html").sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    MailMessage.countDocuments(filter),
  ]);

  return {
    items: items.map((m) => ({
      ...m,
      id: String(m._id),
      text: String(m.text || "").slice(0, PREVIEW_LENGTH),
    })),
    page,
    limit,
    total,
  };
}

async function get(messageId) {
  const message = await MailMessage.findOne({
    _id: messageId,
    organizationId: tenant.requireOrganizationId(),
  }).lean();
  if (!message) throw AppError.notFound("Mail message");
  return { ...message, id: String(message._id) };
}

/** Counts by status over the last day and week, for the mail screen. */
async function stats() {
  const organizationId = new mongoose.Types.ObjectId(tenant.requireOrganizationId());
  const since = (days) => new Date(Date.now() - days * 86400000);

  const bucket = async (from) => {
    const rows = await MailMessage.aggregate([
      { $match: { organizationId, createdAt: { $gte: from } } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);
    return rows.reduce(
      (acc, r) => ({ ...acc, [r._id]: r.count }),
      { queued: 0, sending: 0, sent: 0, failed: 0, simulated: 0, skipped: 0 }
    );
  };

  const [last24h, last7d] = await Promise.all([bucket(since(1)), bucket(since(7))]);
  const lastFailure = await MailMessage.findOne({ organizationId, status: "failed" })
    .sort({ createdAt: -1 })
    .select("to subject error createdAt")
    .lean();

  return { last24h, last7d, lastFailure };
}

module.exports = { deliverEmail, sendNow, resend, list, get, stats, loadAttachments, MailMessage };
