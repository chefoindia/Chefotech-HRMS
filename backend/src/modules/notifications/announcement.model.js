"use strict";

const mongoose = require("mongoose");
const { createTenantSchema } = require("../../core/tenancy/baseSchema");

/**
 * A company announcement: what was said, to whom, when, and who has read it.
 *
 * Sending an announcement used to fan out notifications and keep nothing.
 * There was no way to see last month's notice, to schedule one for Monday
 * morning, or to answer "has everyone acknowledged the new leave policy?" —
 * which is the question HR is actually asked.
 */
const acknowledgementSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const announcementSchema = createTenantSchema({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  message: { type: String, required: true, maxlength: 8000 },

  audience: {
    type: { type: String, enum: ["all", "department", "location", "employees"], default: "all" },
    departmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Department", default: null },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", default: null },
    employeeIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Employee" }],
  },

  channels: { type: [String], default: ["in_app", "email"] },
  attachmentFileIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "StoredFile" }],

  /** Employees are asked to confirm they have read it. */
  requireAcknowledgement: { type: Boolean, default: false },
  acknowledgements: { type: [acknowledgementSchema], default: [] },

  /** Null sends immediately; a future instant is picked up by the scheduler. */
  scheduledFor: { type: Date, default: null, index: true },

  status: {
    type: String,
    enum: ["scheduled", "sending", "sent", "failed", "cancelled"],
    default: "scheduled",
    index: true,
  },
  sentAt: { type: Date, default: null },
  recipientCount: { type: Number, default: 0 },
  delivery: { type: mongoose.Schema.Types.Mixed, default: {} },
  /** Pinned announcements stay at the top of the noticeboard until this date. */
  pinnedUntil: { type: Date, default: null },
  error: { type: String, default: null },
});

announcementSchema.index({ organizationId: 1, status: 1, scheduledFor: 1 });
announcementSchema.index({ organizationId: 1, sentAt: -1 });

module.exports = mongoose.model("Announcement", announcementSchema);
