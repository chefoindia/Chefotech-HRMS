"use strict";

const mongoose = require("mongoose");
const { createTenantSchema, tenantUnique } = require("../../core/tenancy/baseSchema");

/**
 * Company assets — laptops, phones, ID cards, vehicles, tools — and who has
 * them. An assignment is a row rather than a field on the asset so the
 * history survives: who had this laptop in 2025 matters when it turns up
 * with a cracked screen in 2027.
 */
const ASSET_CATEGORIES = ["laptop", "desktop", "monitor", "phone", "sim", "id_card", "access_card", "vehicle", "furniture", "tool", "uniform", "software_licence", "other"];
const ASSET_STATUSES = ["available", "assigned", "in_repair", "lost", "retired"];
const ASSET_CONDITIONS = ["new", "good", "fair", "poor", "damaged"];

const assetSchema = createTenantSchema({
  tag: { type: String, required: true, trim: true, uppercase: true, maxlength: 40 },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  category: { type: String, enum: ASSET_CATEGORIES, default: "other", index: true },
  make: { type: String, default: "" },
  model: { type: String, default: "" },
  serialNumber: { type: String, default: "", trim: true },
  purchaseDate: { type: Date, default: null },
  purchaseCost: { type: Number, default: null },
  vendor: { type: String, default: "" },
  warrantyUntil: { type: Date, default: null },
  locationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", default: null },
  notes: { type: String, default: "", maxlength: 2000 },

  status: { type: String, enum: ASSET_STATUSES, default: "available", index: true },
  condition: { type: String, enum: ASSET_CONDITIONS, default: "good" },

  /** Denormalised for list screens; the assignment row is the truth. */
  currentAssignmentId: { type: mongoose.Schema.Types.ObjectId, ref: "AssetAssignment", default: null },
  currentEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null, index: true },
});

tenantUnique(assetSchema, "tag");
assetSchema.index({ organizationId: 1, status: 1, category: 1 });

const Asset = mongoose.model("Asset", assetSchema);

const assignmentSchema = createTenantSchema(
  {
    assetId: { type: mongoose.Schema.Types.ObjectId, ref: "Asset", required: true, index: true },
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
    assignedOn: { type: Date, required: true },
    expectedReturnOn: { type: Date, default: null },
    conditionAtAssignment: { type: String, enum: ASSET_CONDITIONS, default: "good" },
    notes: { type: String, default: "" },

    /** The employee confirms they received it. */
    acknowledgedAt: { type: Date, default: null },
    acknowledgedName: { type: String, default: "" },

    returnedOn: { type: Date, default: null },
    conditionAtReturn: { type: String, enum: ASSET_CONDITIONS, default: null },
    returnNotes: { type: String, default: "" },
    returnedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    /** Charged to the leaver for loss or damage, filed as a payroll deduction. */
    recoveryAmount: { type: Number, default: 0 },
    recoveryInputId: { type: mongoose.Schema.Types.ObjectId, ref: "PayrollInput", default: null },
    reminderSentAt: { type: Date, default: null },
  },
  { softDelete: false }
);

assignmentSchema.index({ organizationId: 1, employeeId: 1, returnedOn: 1 });

const AssetAssignment = mongoose.model("AssetAssignment", assignmentSchema);

module.exports = { Asset, AssetAssignment, ASSET_CATEGORIES, ASSET_STATUSES, ASSET_CONDITIONS };
