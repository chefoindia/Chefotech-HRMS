"use strict";

const mongoose = require("mongoose");
const { createGlobalSchema } = require("../../core/tenancy/baseSchema");

/**
 * A device that can receive push notifications for one user.
 *
 * Global, keyed by user rather than by organization: a consultant who belongs
 * to two organizations registers the phone once and must hear from both. The
 * notification service resolves recipients to user ids before it looks here,
 * so tenant scoping is already applied upstream.
 *
 * Two kinds of token:
 *   expo  — the Expo push token the mobile app obtains from the OS
 *   web   — a browser Push API subscription (endpoint + keys), for the web app
 */
const deviceTokenSchema = createGlobalSchema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

  kind: { type: String, enum: ["expo", "web"], required: true },
  /** The Expo token, or the web push endpoint URL. Unique per device. */
  token: { type: String, required: true, unique: true },
  /** Web push only: the encryption keys the browser handed us. */
  subscription: {
    endpoint: { type: String, default: null },
    keys: { p256dh: { type: String, default: null }, auth: { type: String, default: null } },
  },

  platform: { type: String, enum: ["ios", "android", "web", "unknown"], default: "unknown" },
  deviceName: { type: String, default: "" },
  appVersion: { type: String, default: "" },
  userAgent: { type: String, default: "" },

  lastSeenAt: { type: Date, default: Date.now },
  lastDeliveredAt: { type: Date, default: null },
  failures: { type: Number, default: 0 },

  /**
   * Expo answers a send with a ticket, and only later with a receipt that
   * says whether the OS actually took it. Tickets wait here until the receipt
   * job has checked them, which is how a token for an uninstalled app is
   * found and retired rather than sent to forever.
   */
  pendingTickets: {
    type: [{ id: String, at: Date }],
    default: [],
  },

  disabledAt: { type: Date, default: null },
  disabledReason: { type: String, default: null },
});

deviceTokenSchema.index({ userId: 1, disabledAt: 1 });
deviceTokenSchema.index({ "pendingTickets.at": 1 });

module.exports = mongoose.model("DeviceToken", deviceTokenSchema);
