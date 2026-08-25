"use strict";

const mongoose = require("mongoose");
const { createTenantSchema, tenantUnique } = require("../../core/tenancy/baseSchema");

/**
 * A repeating shift schedule.
 *
 * A single standing shift per employee covers the common office case and
 * nothing else. Real rosters rotate: a plant runs morning/evening/night on a
 * cycle, a support desk works a late shift only on Wednesdays, a security
 * team runs four days on and two off. Expressing that by creating a dated
 * assignment for every employee for every day is unworkable — it is thousands
 * of rows a month that somebody has to maintain by hand.
 *
 * So a pattern is declared once and evaluated per date. Two shapes cover
 * essentially every real roster:
 *
 *   weekly    Fixed by day of week. "Monday and Tuesday morning shift,
 *             Wednesday late shift, Saturday off." Repeats every 7 days and
 *             is what most people mean by a rota.
 *
 *   rotating  A cycle of any length, anchored to a start date. "Three days
 *             morning, three days night, one day off" is a 7-day cycle; a
 *             continental shift pattern is a 28-day one. The cycle advances
 *             regardless of weekday, which is exactly what distinguishes it
 *             from the weekly shape.
 *
 * A null shift in either shape means a day off, so a pattern can express the
 * whole roster including rest days rather than needing a separate weekly-off
 * policy layered on top.
 */

const patternDaySchema = new mongoose.Schema(
  {
    /** 0 = Sunday … 6 = Saturday, for a weekly pattern. */
    day: { type: Number, min: 0, max: 6 },
    /** 0-based position in the cycle, for a rotating pattern. */
    position: { type: Number, min: 0 },
    /** null means a day off — the pattern covers rest days too. */
    shiftId: { type: mongoose.Schema.Types.ObjectId, ref: "Shift", default: null },
  },
  { _id: false }
);

const shiftPatternSchema = createTenantSchema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true, uppercase: true },
  description: { type: String, default: "" },

  type: { type: String, enum: ["weekly", "rotating"], default: "weekly", index: true },

  /** Weekly patterns: one entry per weekday that differs from a plain day off. */
  days: { type: [patternDaySchema], default: [] },

  /** Rotating patterns: the cycle, in order. */
  cycle: { type: [patternDaySchema], default: [] },
  /**
   * The date the cycle's position 0 falls on. Without an anchor a rotating
   * pattern has no way to know where in the cycle "today" sits — and shifting
   * this by one day shifts the entire roster for everyone on it, so it is
   * deliberately explicit rather than inferred from a creation timestamp.
   */
  anchorDate: { type: String, default: null },

  colour: { type: String, default: "#4F46E5" },
  isActive: { type: Boolean, default: true, index: true },
  employeeCount: { type: Number, default: 0 },
});

tenantUnique(shiftPatternSchema, "code");
shiftPatternSchema.index({ organizationId: 1, isActive: 1 });

/** How many days before a rotating pattern repeats. */
shiftPatternSchema.virtual("cycleLength").get(function cycleLength() {
  return this.type === "rotating" ? (this.cycle || []).length : 7;
});

shiftPatternSchema.pre("validate", function requireAnchor(next) {
  if (this.type === "rotating") {
    if (!this.cycle || this.cycle.length === 0) {
      return next(new Error("A rotating pattern needs at least one day in its cycle."));
    }
    if (!this.anchorDate) {
      return next(new Error("A rotating pattern needs a start date, so it knows where the cycle begins."));
    }
  }
  next();
});

module.exports = mongoose.model("ShiftPattern", shiftPatternSchema);
