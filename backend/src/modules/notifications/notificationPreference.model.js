"use strict";

const mongoose = require("mongoose");
const { createGlobalSchema } = require("../../core/tenancy/baseSchema");

const CATEGORIES = [
  "leave",
  "attendance",
  "payroll",
  "document",
  "workflow",
  "employee",
  "system",
  "announcement",
  "ticket",
  "expense",
  "asset",
];

/**
 * How one person wants to be reached.
 *
 * Per user, not per organization: it is the same phone in someone's pocket
 * whichever company the message is about. The organization decides which
 * channels EXIST (settings → notification.channels_enabled); the person
 * decides which of those they want, per category — "email me about payroll,
 * but not every attendance mark".
 *
 * In-app is not configurable. The bell is the record of what happened, and a
 * person switching it off would only be hiding things from themselves.
 */
const notificationPreferenceSchema = createGlobalSchema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },

  emailEnabled: { type: Boolean, default: true },
  pushEnabled: { type: Boolean, default: true },

  /** Category → channel pairs the person has switched off. */
  muted: {
    type: [
      {
        category: { type: String, enum: CATEGORIES, required: true },
        channel: { type: String, enum: ["email", "push"], required: true },
      },
    ],
    default: [],
  },

  /**
   * Push is held during these hours; the in-app record is written regardless,
   * and email is not affected because nobody's phone buzzes for an email.
   */
  quietHours: {
    enabled: { type: Boolean, default: false },
    start: { type: String, default: "22:00" },
    end: { type: String, default: "07:00" },
  },

  /** The morning summary email for managers and HR. */
  dailyDigest: { type: Boolean, default: true },
});

module.exports = mongoose.model("NotificationPreference", notificationPreferenceSchema);
module.exports.CATEGORIES = CATEGORIES;
