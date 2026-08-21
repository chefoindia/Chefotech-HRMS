"use strict";

const mongoose = require("mongoose");
const { createTenantSchema, tenantUnique } = require("../tenancy/baseSchema");

/**
 * Per-organization setting overrides.
 *
 * Only values that differ from the registry default are stored. That keeps the
 * collection small, makes "reset to default" a delete, and means shipping a
 * new default reaches every tenant that never customised it.
 */
const settingSchema = createTenantSchema(
  {
    key: { type: String, required: true, index: true },
    value: { type: mongoose.Schema.Types.Mixed, default: null },
    type: { type: String, required: true },
    updatedByName: { type: String, default: null },
  },
  { softDelete: false }
);

tenantUnique(settingSchema, "key");

module.exports = mongoose.model("Setting", settingSchema);
