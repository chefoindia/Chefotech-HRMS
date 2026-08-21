"use strict";

const mongoose = require("mongoose");
const { createTenantSchema, tenantUnique } = require("../../core/tenancy/baseSchema");

const departmentSchema = createTenantSchema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true, uppercase: true },
  description: { type: String, default: "" },

  // Departments nest: Operations > Production > Cutting.
  parentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Department",
    default: null,
    index: true,
  },
  /** Materialised path of ancestor ids — makes "everything under X" one query. */
  ancestorIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Department" }],
  depth: { type: Number, default: 0 },

  headEmployeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Employee",
    default: null,
  },

  costCentre: { type: String, default: "" },
  isActive: { type: Boolean, default: true, index: true },
  employeeCount: { type: Number, default: 0 },
});

tenantUnique(departmentSchema, "code");
departmentSchema.index({ organizationId: 1, name: 1 });
departmentSchema.index({ organizationId: 1, ancestorIds: 1 });

module.exports = mongoose.model("Department", departmentSchema);
