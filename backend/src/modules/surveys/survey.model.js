"use strict";

const mongoose = require("mongoose");
const { createTenantSchema } = require("../../core/tenancy/baseSchema");

/**
 * Pulse surveys.
 *
 * A survey is a handful of questions to an audience, open for a window.
 * Anonymous surveys never store who answered: each response carries a
 * one-way key derived from a per-survey salt and the employee, enough to
 * stop a second answer and to know who has not answered yet, never enough
 * to say who wrote what.
 */

const QUESTION_TYPES = ["rating", "scale", "single", "multi", "yes_no", "text"];
const AUDIENCE_TYPES = ["all", "department", "location", "employees"];
const SURVEY_STATUSES = ["draft", "open", "closed"];

const questionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    type: { type: String, enum: QUESTION_TYPES, required: true },
    prompt: { type: String, required: true, trim: true, maxlength: 300 },
    help: { type: String, default: "", maxlength: 300 },
    options: { type: [String], default: [] },
    required: { type: Boolean, default: true },
    /** For rating/scale: the top of the scale (1..max). */
    max: { type: Number, default: 5, min: 2, max: 10 },
    lowLabel: { type: String, default: "" },
    highLabel: { type: String, default: "" },
  },
  { _id: false }
);

const surveySchema = createTenantSchema({
  title: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, default: "", maxlength: 2000 },
  questions: { type: [questionSchema], default: [] },
  audience: {
    type: { type: String, enum: AUDIENCE_TYPES, default: "all" },
    departmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Department", default: null },
    locationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", default: null },
    employeeIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  },
  anonymous: { type: Boolean, default: true },
  status: { type: String, enum: SURVEY_STATUSES, default: "draft", index: true },
  opensAt: { type: Date, default: null },
  closesAt: { type: Date, default: null },
  closedAt: { type: Date, default: null },
  invitedCount: { type: Number, default: 0 },
  respondedCount: { type: Number, default: 0 },
  reminderSentAt: { type: Date, default: null },
  /** Salt for the one-way respondent key. Never leaves the server. */
  salt: { type: String, select: false },
});

surveySchema.index({ organizationId: 1, status: 1, closesAt: 1 });

const responseSchema = createTenantSchema({
  surveyId: { type: mongoose.Schema.Types.ObjectId, ref: "Survey", required: true, index: true },
  /** Null for anonymous surveys. */
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },
  respondentKey: { type: String, required: true },
  answers: {
    type: [
      new mongoose.Schema(
        {
          questionId: { type: String, required: true },
          value: { type: mongoose.Schema.Types.Mixed, default: null },
        },
        { _id: false }
      ),
    ],
    default: [],
  },
  submittedAt: { type: Date, default: Date.now },
});

responseSchema.index({ organizationId: 1, surveyId: 1, respondentKey: 1 }, { unique: true });

module.exports = {
  Survey: mongoose.model("Survey", surveySchema),
  SurveyResponse: mongoose.model("SurveyResponse", responseSchema),
  QUESTION_TYPES,
  AUDIENCE_TYPES,
  SURVEY_STATUSES,
};
