"use strict";

const mongoose = require("mongoose");
const { createTenantSchema } = require("../../core/tenancy/baseSchema");

/** An in-app notification for one recipient. */
const notificationSchema = createTenantSchema(
  {
    recipientUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    recipientEmployeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      default: null,
    },

    templateKey: { type: String, default: null },
    event: { type: String, required: true, index: true },

    title: { type: String, required: true },
    body: { type: String, default: "" },
    actionUrl: { type: String, default: null },

    severity: {
      type: String,
      enum: ["info", "success", "warning", "critical"],
      default: "info",
    },
    category: {
      type: String,
      enum: [
        "leave", "attendance", "payroll", "document", "workflow", "employee",
        "system", "announcement", "ticket", "expense", "asset",
      ],
      default: "system",
      index: true,
    },

    entityType: { type: String, default: null },
    entityId: { type: mongoose.Schema.Types.ObjectId, default: null },

    readAt: { type: Date, default: null, index: true },
    // Delivery outcome per channel, so a failed email is visible rather than
    // silently swallowed.
    delivery: {
      type: Map,
      of: new mongoose.Schema(
        {
          status: { type: String, enum: ["pending", "sent", "failed", "skipped"], default: "pending" },
          at: Date,
          error: String,
        },
        { _id: false }
      ),
      default: {},
    },
  },
  { softDelete: false }
);

notificationSchema.index({ organizationId: 1, recipientUserId: 1, readAt: 1, createdAt: -1 });
// The bell is a recent-activity feed, not an archive.
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 3600 });

module.exports = mongoose.model("Notification", notificationSchema);
