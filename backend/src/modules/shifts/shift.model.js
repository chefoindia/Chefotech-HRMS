"use strict";

const mongoose = require("mongoose");
const { createTenantSchema, tenantUnique } = require("../../core/tenancy/baseSchema");
const { timeToMinutes } = require("../../shared/datetime");

/**
 * A shift describes WHEN work happens. It deliberately does not describe what
 * counts as late or as a half day — those are attendance-policy rules, so that
 * one policy can be applied across many shifts and a company can change its
 * grace period without editing every shift.
 */
const shiftSchema = createTenantSchema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true, uppercase: true },
  description: { type: String, default: "" },

  type: {
    type: String,
    enum: ["fixed", "flexible", "rotational"],
    default: "fixed",
  },

  /** "09:00" / "18:00" in the organization's (or location's) timezone. */
  startTime: { type: String, required: true },
  endTime: { type: String, required: true },

  /**
   * Derived from the times, never configured. A 22:00–06:00 shift ends on the
   * following calendar day, and getting this wrong silently turns every night
   * worker's attendance into an absence.
   */
  crossesMidnight: { type: Boolean, default: false },

  breakMinutes: { type: Number, default: 60, min: 0, max: 480 },
  /** Paid breaks count toward worked hours; unpaid ones are deducted. */
  isBreakPaid: { type: Boolean, default: false },

  /**
   * Flexible shifts ignore start/end and only require a total. Used for
   * consultants and remote staff who are measured on hours, not punctuality.
   */
  flexibleMinimumMinutes: { type: Number, default: 480 },
  /** Core hours a flexible worker must still be present for, if any. */
  coreStartTime: { type: String, default: null },
  coreEndTime: { type: String, default: null },

  colour: { type: String, default: "#4F46E5" },
  isDefault: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true, index: true },
  employeeCount: { type: Number, default: 0 },
});

tenantUnique(shiftSchema, "code");
shiftSchema.index({ organizationId: 1, isActive: 1 });

/** Scheduled duration in minutes, net of unpaid break. */
shiftSchema.virtual("durationMinutes").get(function durationMinutes() {
  if (this.type === "flexible") return this.flexibleMinimumMinutes;
  const start = timeToMinutes(this.startTime);
  const end = timeToMinutes(this.endTime);
  const gross = end > start ? end - start : 1440 - start + end;
  return this.isBreakPaid ? gross : gross - (this.breakMinutes || 0);
});

shiftSchema.pre("validate", function deriveMidnight(next) {
  if (this.startTime && this.endTime) {
    this.crossesMidnight = timeToMinutes(this.endTime) <= timeToMinutes(this.startTime);
  }
  next();
});

/** Only one default shift per organization. */
shiftSchema.pre("save", async function enforceSingleDefault(next) {
  if (this.isDefault && this.isModified("isDefault")) {
    await this.constructor.updateMany(
      { _id: { $ne: this._id }, isDefault: true },
      { $set: { isDefault: false } }
    );
  }
  next();
});

module.exports = mongoose.model("Shift", shiftSchema);
