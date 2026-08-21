"use strict";

const mongoose = require("mongoose");
const { createTenantSchema, tenantUnique } = require("../../core/tenancy/baseSchema");

const designationSchema = createTenantSchema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true, uppercase: true },
  description: { type: String, default: "" },

  /** Optional band/grade. Used by salary structures and approval routing. */
  grade: { type: String, default: "" },
  /** 1 = most senior. Drives "who can approve whom" in default workflows. */
  level: { type: Number, default: 5, min: 1, max: 20 },

  departmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Department",
    default: null,
    index: true,
  },

  isActive: { type: Boolean, default: true, index: true },
  employeeCount: { type: Number, default: 0 },
});

tenantUnique(designationSchema, "code");
designationSchema.index({ organizationId: 1, name: 1 });

module.exports = mongoose.model("Designation", designationSchema);
