"use strict";

const mongoose = require("mongoose");
const { createTenantSchema, tenantUnique } = require("../../core/tenancy/baseSchema");

/**
 * A tenant-defined employee field.
 *
 * The definition lives here; the value lives in `employee.customFields` as a
 * Map entry. That keeps "ABC Garments needs a Uniform Size field" a data
 * change rather than a schema migration, and keeps one tenant's fields
 * invisible to every other tenant.
 */
const FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "date",
  "dropdown",
  "multiselect",
  "boolean",
  "email",
  "phone",
  "file",
  "currency",
];

const customFieldSchema = createTenantSchema({
  key: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    match: [/^[a-z][a-z0-9_]{1,39}$/, "Use lowercase letters, numbers and underscores"],
  },
  label: { type: String, required: true, trim: true },
  helpText: { type: String, default: "" },
  type: { type: String, enum: FIELD_TYPES, required: true },

  /** Which profile tab it appears on. */
  section: {
    type: String,
    enum: ["personal", "employment", "statutory", "bank", "other"],
    default: "other",
  },

  options: {
    type: [{ value: String, label: String }],
    default: [],
  },

  required: { type: Boolean, default: false },
  unique: { type: Boolean, default: false },
  defaultValue: { type: mongoose.Schema.Types.Mixed, default: null },

  validation: {
    min: { type: Number, default: null },
    max: { type: Number, default: null },
    minLength: { type: Number, default: null },
    maxLength: { type: Number, default: null },
    pattern: { type: String, default: null },
  },

  /** Treated like bank/identity data — needs employee.view_sensitive. */
  isSensitive: { type: Boolean, default: false },
  /** Whether the employee may edit it in self-service. */
  employeeEditable: { type: Boolean, default: false },
  showInList: { type: Boolean, default: false },

  order: { type: Number, default: 100 },
  isActive: { type: Boolean, default: true },
});

tenantUnique(customFieldSchema, "key");
customFieldSchema.index({ organizationId: 1, section: 1, order: 1 });

module.exports = mongoose.model("EmployeeCustomField", customFieldSchema);
module.exports.FIELD_TYPES = FIELD_TYPES;
