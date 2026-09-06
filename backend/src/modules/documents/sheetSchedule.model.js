"use strict";

const mongoose = require("mongoose");
const { createTenantSchema } = require("../../core/tenancy/baseSchema");

/**
 * A scheduled sheet: "email the salary register to accounts on the 2nd of
 * every month", "send the late-arrival register to the plant head every
 * Monday". The sheet's own filters supply the shape; the period is
 * relative so the same schedule works every time it fires.
 */
const PERIODS = ["yesterday", "last_7_days", "this_week", "last_week", "this_month", "last_month", "last_payroll_run", "none"];

const scheduleSchema = createTenantSchema({
  sheetId: { type: mongoose.Schema.Types.ObjectId, ref: "SheetTemplate", required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  frequency: { type: String, enum: ["daily", "weekly", "monthly"], required: true },
  /** 0 = Sunday … 6 = Saturday, for weekly. */
  dayOfWeek: { type: Number, min: 0, max: 6, default: 1 },
  /** 1–28, for monthly. */
  dayOfMonth: { type: Number, min: 1, max: 28, default: 1 },
  /** Local hour, 0–23. */
  hour: { type: Number, min: 0, max: 23, default: 8 },
  period: { type: String, enum: PERIODS, default: "last_month" },
  format: { type: String, enum: ["xlsx", "csv", "pdf"], default: "xlsx" },
  /** Extra fixed filters (a department, a location) merged over the sheet's own. */
  filters: { type: mongoose.Schema.Types.Mixed, default: {} },
  recipients: { type: [String], default: [] },
  subject: { type: String, default: "" },
  message: { type: String, default: "", maxlength: 1000 },
  isActive: { type: Boolean, default: true, index: true },
  lastRunAt: { type: Date, default: null },
  lastRunStatus: { type: String, enum: ["ok", "failed", null], default: null },
  lastError: { type: String, default: null },
  lastFileId: { type: mongoose.Schema.Types.ObjectId, ref: "StoredFile", default: null },
  /** The local date-hour this last fired, so an hourly sweep fires each schedule once. */
  lastFiredKey: { type: String, default: null },
});

scheduleSchema.index({ organizationId: 1, isActive: 1 });

module.exports = { SheetSchedule: mongoose.model("SheetSchedule", scheduleSchema), PERIODS };
