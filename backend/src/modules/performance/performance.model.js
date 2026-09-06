"use strict";

const mongoose = require("mongoose");
const { createTenantSchema } = require("../../core/tenancy/baseSchema");

/**
 * Goals and reviews.
 *
 * A goal belongs to an employee and moves from 0 to 100. A review cycle
 * picks an audience and a period, creates one review per participant with
 * their manager as reviewer, and walks self-review → manager review →
 * completed → acknowledged. Goals are snapshotted into the review when the
 * cycle starts, so the conversation is about what was agreed, not what was
 * edited the night before.
 */

const GOAL_STATUSES = ["active", "completed", "cancelled"];
const CYCLE_STATUSES = ["draft", "self_review", "manager_review", "closed"];
const REVIEW_STATUSES = ["pending_self", "pending_manager", "completed", "acknowledged"];
const AUDIENCE_TYPES = ["all", "department", "location", "employees"];

const goalSchema = createTenantSchema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
  cycleId: { type: mongoose.Schema.Types.ObjectId, ref: "ReviewCycle", default: null, index: true },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, default: "", maxlength: 2000 },
  /** How success is measured and what "done" looks like. */
  metric: { type: String, default: "", maxlength: 200 },
  target: { type: String, default: "", maxlength: 120 },
  weight: { type: Number, default: 25, min: 1, max: 100 },
  progress: { type: Number, default: 0, min: 0, max: 100 },
  status: { type: String, enum: GOAL_STATUSES, default: "active", index: true },
  dueDate: { type: Date, default: null },
  alignedToId: { type: mongoose.Schema.Types.ObjectId, ref: "Goal", default: null },
  updates: {
    type: [
      new mongoose.Schema(
        {
          at: { type: Date, default: Date.now },
          by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
          byName: { type: String, default: "" },
          progress: { type: Number, default: 0 },
          note: { type: String, default: "", maxlength: 1000 },
        },
        { _id: false }
      ),
    ],
    default: [],
  },
  completedAt: { type: Date, default: null },
});

goalSchema.index({ organizationId: 1, employeeId: 1, status: 1 });

const sectionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    title: { type: String, required: true, maxlength: 120 },
    description: { type: String, default: "", maxlength: 600 },
    rated: { type: Boolean, default: true },
  },
  { _id: false }
);

const DEFAULT_SECTIONS = [
  { key: "results", title: "Results and goals", description: "What was delivered against what was agreed.", rated: true },
  { key: "quality", title: "Quality of work", description: "Accuracy, thoroughness, and how little needs redoing.", rated: true },
  { key: "collaboration", title: "Collaboration", description: "How this person works with their team and other teams.", rated: true },
  { key: "growth", title: "Growth", description: "Skills built this period and where to go next.", rated: true },
  { key: "overall", title: "Overall comments", description: "Anything not covered above.", rated: false },
];

const cycleSchema = createTenantSchema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  periodStart: { type: Date, required: true },
  periodEnd: { type: Date, required: true },
  status: { type: String, enum: CYCLE_STATUSES, default: "draft", index: true },
  audience: {
    type: { type: String, enum: AUDIENCE_TYPES, default: "all" },
    departmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Department", default: null },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", default: null },
    employeeIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  },
  sections: { type: [sectionSchema], default: DEFAULT_SECTIONS },
  ratingScale: { type: Number, default: 5, min: 3, max: 10 },
  selfReviewRequired: { type: Boolean, default: true },
  selfDueAt: { type: Date, default: null },
  managerDueAt: { type: Date, default: null },
  startedAt: { type: Date, default: null },
  closedAt: { type: Date, default: null },
  participants: { type: Number, default: 0 },
});

const reviewSchema = createTenantSchema({
  cycleId: { type: mongoose.Schema.Types.ObjectId, ref: "ReviewCycle", required: true, index: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
  reviewerId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null, index: true },
  status: { type: String, enum: REVIEW_STATUSES, default: "pending_self", index: true },
  self: {
    ratings: { type: mongoose.Schema.Types.Mixed, default: {} },
    answers: { type: mongoose.Schema.Types.Mixed, default: {} },
    submittedAt: { type: Date, default: null },
  },
  manager: {
    ratings: { type: mongoose.Schema.Types.Mixed, default: {} },
    answers: { type: mongoose.Schema.Types.Mixed, default: {} },
    overallRating: { type: Number, default: null },
    summary: { type: String, default: "", maxlength: 4000 },
    submittedAt: { type: Date, default: null },
  },
  goalsSnapshot: {
    type: [
      new mongoose.Schema(
        {
          goalId: { type: mongoose.Schema.Types.ObjectId, ref: "Goal" },
          title: { type: String, default: "" },
          progress: { type: Number, default: 0 },
          weight: { type: Number, default: 0 },
          status: { type: String, default: "active" },
        },
        { _id: false }
      ),
    ],
    default: [],
  },
  employeeComment: { type: String, default: "", maxlength: 2000 },
  acknowledgedAt: { type: Date, default: null },
});

reviewSchema.index({ organizationId: 1, cycleId: 1, employeeId: 1 }, { unique: true });

module.exports = {
  Goal: mongoose.model("Goal", goalSchema),
  ReviewCycle: mongoose.model("ReviewCycle", cycleSchema),
  Review: mongoose.model("Review", reviewSchema),
  GOAL_STATUSES,
  CYCLE_STATUSES,
  REVIEW_STATUSES,
  AUDIENCE_TYPES,
  DEFAULT_SECTIONS,
};
