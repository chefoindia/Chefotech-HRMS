"use strict";

const mongoose = require("mongoose");
const { createTenantSchema, tenantUnique } = require("../../core/tenancy/baseSchema");

/**
 * Holiday calendars.
 *
 * A calendar belongs to a year and can be attached to locations or to
 * individual employees. Multiple calendars per organization is the normal
 * case, not an edge case: Kerala and Punjab share almost no regional holidays.
 */
const holidayCalendarSchema = createTenantSchema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true, uppercase: true },
  year: { type: Number, required: true, index: true },
  description: { type: String, default: "" },

  /** Locations this calendar applies to. Empty means "available to all". */
  locationIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Location" }],

  /**
   * Restricted/optional holidays: employees pick a limited number from a
   * larger list. 0 means the feature is unused for this calendar.
   */
  optionalHolidayQuota: { type: Number, default: 0, min: 0, max: 20 },

  isDefault: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  holidayCount: { type: Number, default: 0 },
});

tenantUnique(holidayCalendarSchema, ["code", "year"]);
holidayCalendarSchema.index({ organizationId: 1, year: 1, isActive: 1 });

holidayCalendarSchema.pre("save", async function enforceSingleDefault(next) {
  if (this.isDefault && this.isModified("isDefault")) {
    await this.constructor.updateMany(
      { _id: { $ne: this._id }, year: this.year, isDefault: true },
      { $set: { isDefault: false } }
    );
  }
  next();
});

const HolidayCalendar = mongoose.model("HolidayCalendar", holidayCalendarSchema);

const holidaySchema = createTenantSchema({
  calendarId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "HolidayCalendar",
    required: true,
    index: true,
  },

  name: { type: String, required: true, trim: true },
  /** "YYYY-MM-DD". A holiday is a calendar date, never an instant. */
  date: { type: String, required: true, index: true },

  type: {
    type: String,
    enum: ["public", "national", "regional", "company", "optional", "restricted"],
    default: "public",
  },

  description: { type: String, default: "" },
  isHalfDay: { type: String, enum: ["", "first", "second"], default: "" },
  /** Employees must pick these; they are not automatically non-working. */
  isOptional: { type: Boolean, default: false },
  isPaid: { type: Boolean, default: true },
  colour: { type: String, default: "#0EA5E9" },
});

// The same calendar cannot hold two entries for one date.
tenantUnique(holidaySchema, ["calendarId", "date"]);
holidaySchema.index({ organizationId: 1, date: 1 });

const Holiday = mongoose.model("Holiday", holidaySchema);

/** An employee's chosen optional holidays for a year. */
const optionalHolidaySelectionSchema = createTenantSchema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
  holidayId: { type: mongoose.Schema.Types.ObjectId, ref: "Holiday", required: true },
  year: { type: Number, required: true },
  date: { type: String, required: true },
});

tenantUnique(optionalHolidaySelectionSchema, ["employeeId", "holidayId"]);

const OptionalHolidaySelection = mongoose.model(
  "OptionalHolidaySelection",
  optionalHolidaySelectionSchema
);

module.exports = { HolidayCalendar, Holiday, OptionalHolidaySelection };
