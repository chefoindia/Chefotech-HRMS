"use strict";

const mongoose = require("mongoose");
const { createTenantSchema, tenantUnique } = require("../../core/tenancy/baseSchema");

/**
 * Which days of the week are off.
 *
 * Modelled per-weekday with an occurrence rule rather than a simple
 * "weekendDays: [0,6]" array, because the common Indian arrangement is
 * "Sunday off, plus the 2nd and 4th Saturday" — which a boolean array cannot
 * express, and which every manufacturing customer will ask for on day one.
 */
const dayRuleSchema = new mongoose.Schema(
  {
    /** 0 = Sunday … 6 = Saturday */
    day: { type: Number, required: true, min: 0, max: 6 },
    type: {
      type: String,
      enum: ["working", "off", "half_day", "alternate"],
      default: "working",
    },
    /**
     * For type "alternate": which occurrences in the month are off.
     * [2, 4] = the 2nd and 4th of that weekday.
     */
    offOccurrences: { type: [Number], default: [] },
    /** For type "half_day": which half is worked. */
    halfDaySession: { type: String, enum: ["first", "second"], default: "first" },
  },
  { _id: false }
);

const weeklyOffPolicySchema = createTenantSchema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true, uppercase: true },
  description: { type: String, default: "" },

  days: {
    type: [dayRuleSchema],
    default: () => [
      { day: 0, type: "off" },
      { day: 1, type: "working" },
      { day: 2, type: "working" },
      { day: 3, type: "working" },
      { day: 4, type: "working" },
      { day: 5, type: "working" },
      { day: 6, type: "working" },
    ],
  },

  isDefault: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
});

tenantUnique(weeklyOffPolicySchema, "code");

weeklyOffPolicySchema.pre("save", async function enforceSingleDefault(next) {
  if (this.isDefault && this.isModified("isDefault")) {
    await this.constructor.updateMany(
      { _id: { $ne: this._id }, isDefault: true },
      { $set: { isDefault: false } }
    );
  }
  next();
});

module.exports = mongoose.model("WeeklyOffPolicy", weeklyOffPolicySchema);
