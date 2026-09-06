"use strict";

const mongoose = require("mongoose");
const { createTenantSchema } = require("../../core/tenancy/baseSchema");

/**
 * Help desk tickets: an employee asks IT, HR, payroll or admin for
 * something and can see it being handled. Comments are the conversation;
 * internal notes are visible to agents only.
 */
const TICKET_CATEGORIES = ["it", "hr", "payroll", "facilities", "finance", "other"];
const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"];
const TICKET_STATUSES = ["open", "in_progress", "waiting_on_requester", "resolved", "closed"];

const commentSchema = new mongoose.Schema(
  {
    authorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    authorName: { type: String, default: "" },
    body: { type: String, required: true, maxlength: 4000 },
    /** Agents only; the requester never sees it. */
    internal: { type: Boolean, default: false },
    attachmentFileIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "StoredFile" }],
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const ticketSchema = createTenantSchema({
  number: { type: Number, required: true },
  subject: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, default: "", maxlength: 8000 },
  category: { type: String, enum: TICKET_CATEGORIES, default: "other", index: true },
  priority: { type: String, enum: TICKET_PRIORITIES, default: "normal", index: true },
  status: { type: String, enum: TICKET_STATUSES, default: "open", index: true },

  requesterUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  requesterEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },
  assigneeUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },

  attachmentFileIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "StoredFile" }],
  comments: { type: [commentSchema], default: [] },

  /** From the category's SLA setting at creation; drives the overdue view. */
  dueAt: { type: Date, default: null, index: true },
  firstResponseAt: { type: Date, default: null },
  resolvedAt: { type: Date, default: null },
  closedAt: { type: Date, default: null },
  resolutionNote: { type: String, default: "" },

  /** Requester's rating on close. */
  rating: { type: Number, min: 1, max: 5, default: null },
  ratingComment: { type: String, default: "" },

  tags: { type: [String], default: [] },
  lastActivityAt: { type: Date, default: Date.now, index: true },
});

ticketSchema.index({ organizationId: 1, number: 1 }, { unique: true });
ticketSchema.index({ organizationId: 1, status: 1, priority: 1, lastActivityAt: -1 });

const Ticket = mongoose.model("Ticket", ticketSchema);

module.exports = { Ticket, TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES };
