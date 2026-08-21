"use strict";

const mongoose = require("mongoose");
const { createTenantSchema, tenantUnique } = require("../../core/tenancy/baseSchema");

/**
 * A place people work from.
 *
 * Locations carry their own timezone and holiday calendar because a company
 * with offices in Kochi and Dubai has two different working weeks and two
 * different holiday lists, and attendance has to be right for both.
 */
const locationSchema = createTenantSchema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true, uppercase: true },

  type: {
    type: String,
    enum: ["head_office", "branch", "factory", "warehouse", "site", "remote", "client_site"],
    default: "branch",
  },

  address: {
    line1: { type: String, default: "" },
    line2: { type: String, default: "" },
    city: { type: String, default: "" },
    state: { type: String, default: "" },
    country: { type: String, default: "India" },
    postalCode: { type: String, default: "" },
  },

  /** Overrides the organization timezone for everyone based here. */
  timezone: { type: String, default: null },

  holidayCalendarId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "HolidayCalendar",
    default: null,
  },

  /** Geofence for web/mobile check-in, when the org has it switched on. */
  geo: {
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
    radiusMetres: { type: Number, default: 200 },
  },

  contactPerson: { type: String, default: "" },
  contactPhone: { type: String, default: "" },

  isActive: { type: Boolean, default: true, index: true },
  employeeCount: { type: Number, default: 0 },
});

tenantUnique(locationSchema, "code");
locationSchema.index({ organizationId: 1, name: 1 });

module.exports = mongoose.model("Location", locationSchema);
