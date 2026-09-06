"use strict";

const mongoose = require("mongoose");
const { createTenantSchema, tenantUnique } = require("../../core/tenancy/baseSchema");

/**
 * A spreadsheet template: a salary sheet, a muster roll, a bank advice, a
 * leave register — any tabular document the organization designs itself.
 *
 * The built-in reports have fixed columns chosen by us. A payroll bureau
 * wants the columns their bank upload expects, a factory wants the muster
 * roll in the layout the labour inspector recognises, an auditor wants the
 * PF register with the columns from the ECR file. None of those is a code
 * change here: a template is a data source plus a list of columns, each with
 * a label, a width, a format and, where needed, a formula over the row.
 *
 * Rendered to XLSX (the real thing, with number formats and frozen headers),
 * CSV, or a landscape PDF with repeated headers.
 */
const columnSchema = new mongoose.Schema(
  {
    /** A field from the data source, or a formula when `expression` is set. */
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    width: { type: Number, default: 16, min: 4, max: 80 },
    format: { type: String, enum: ["text", "number", "integer", "money", "percent", "date", "boolean"], default: "text" },
    align: { type: String, enum: ["left", "center", "right"], default: null },
    /** Sum this column in the totals row. */
    total: { type: Boolean, default: false },
    /**
     * A formula over the row, e.g. "BASIC + HRA" or "gross - deductions".
     * Evaluated by the safe expression engine against the row's own fields.
     */
    expression: { type: String, default: null, maxlength: 500 },
    hidden: { type: Boolean, default: false },
  },
  { _id: false }
);

const sheetTemplateSchema = createTenantSchema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true, uppercase: true },
  description: { type: String, default: "" },

  /** Which rows this sheet is built from — see sheetSources.js. */
  source: { type: String, required: true, index: true },

  columns: { type: [columnSchema], default: [] },

  /** Fixed filters baked into the template, e.g. { status: "active" }. */
  filters: { type: mongoose.Schema.Types.Mixed, default: {} },

  /** Sort by this source field. Prefix with "-" for descending. */
  sort: { type: String, default: null },
  /** Group rows under a subheading by this field, with per-group subtotals. */
  groupBy: { type: String, default: null },

  header: {
    showCompany: { type: Boolean, default: true },
    title: { type: String, default: "" },
    subtitle: { type: String, default: "" },
    showPeriod: { type: Boolean, default: true },
    showGeneratedOn: { type: Boolean, default: true },
  },
  footer: {
    text: { type: String, default: "" },
    showTotals: { type: Boolean, default: true },
    signatureLabels: { type: [String], default: [] },
  },

  page: {
    orientation: { type: String, enum: ["portrait", "landscape"], default: "landscape" },
    size: { type: String, enum: ["A4", "LETTER", "LEGAL", "A3"], default: "A4" },
  },

  freezeHeader: { type: Boolean, default: true },
  showRowNumbers: { type: Boolean, default: true },

  isSystem: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true, index: true },
});

tenantUnique(sheetTemplateSchema, "code");

module.exports = mongoose.model("SheetTemplate", sheetTemplateSchema);
