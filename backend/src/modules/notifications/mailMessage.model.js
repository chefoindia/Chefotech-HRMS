"use strict";

const mongoose = require("mongoose");
const { createGlobalSchema } = require("../../core/tenancy/baseSchema");

/**
 * One outbound email, from the moment it was asked for to the moment the
 * provider accepted or refused it.
 *
 * Until this existed there was no answer to "did the payslip email go out?"
 * other than grepping a log. Every send — queued, retried, simulated in
 * development, rejected by Brevo — leaves a row here, which is what the mail
 * screen in Settings reads and what "resend" replays.
 *
 * Global rather than tenant-scoped on purpose. A password reset for someone
 * who has not chosen an organization, or the "someone tried to sign up with
 * your address" notice, has no tenant at all; a tenant-scoped model would
 * refuse to record exactly the messages that are hardest to debug. Tenant
 * reads filter on `organizationId` explicitly.
 */
const mailMessageSchema = createGlobalSchema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Organization",
    default: null,
    index: true,
  },

  to: { type: String, required: true, index: true },
  toName: { type: String, default: "" },
  replyTo: { type: String, default: null },
  subject: { type: String, required: true },

  /** Kept so a message can be resent verbatim, and previewed in the log. */
  text: { type: String, default: "" },
  html: { type: String, default: "" },

  templateKey: { type: String, default: null, index: true },
  event: { type: String, default: null },
  notificationId: { type: mongoose.Schema.Types.ObjectId, ref: "Notification", default: null },
  recipientUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },

  status: {
    type: String,
    enum: ["queued", "sending", "sent", "failed", "simulated", "skipped"],
    default: "queued",
    index: true,
  },
  provider: { type: String, default: null },
  providerMessageId: { type: String, default: null },
  error: { type: String, default: null },
  attempts: { type: Number, default: 0 },
  lastAttemptAt: { type: Date, default: null },
  sentAt: { type: Date, default: null },

  jobId: { type: mongoose.Schema.Types.ObjectId, ref: "Job", default: null },
  /** Set when this row is a replay of another. */
  resendOf: { type: mongoose.Schema.Types.ObjectId, ref: "MailMessage", default: null },

  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
});

mailMessageSchema.index({ organizationId: 1, createdAt: -1 });
mailMessageSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
// Ninety days is long enough to answer "did it send" for a payroll cycle and
// its dispute window; after that the row is only storage.
mailMessageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

module.exports = mongoose.model("MailMessage", mailMessageSchema);
