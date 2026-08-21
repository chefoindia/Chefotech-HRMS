"use strict";

const mongoose = require("mongoose");
const { createTenantSchema, tenantUnique } = require("../../core/tenancy/baseSchema");

/**
 * A document template.
 *
 * Templates are a list of typed blocks rather than raw HTML, for two reasons:
 * a block list can be edited safely in a visual editor by an HR administrator
 * who does not write markup, and it can be rendered to PDF deterministically
 * without running a browser engine on the server.
 *
 * Placeholders use {{dotted.path}} and are resolved against a context the
 * document service assembles — employee, company, salary, dates.
 */
const blockSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [
        "heading",
        "paragraph",
        "spacer",
        "divider",
        "table",
        "key_values",
        "signature",
        "page_break",
        "image",
        "list",
      ],
      required: true,
    },

    text: { type: String, default: "" },

    /** Table and key-value blocks. */
    columns: { type: [{ key: String, label: String, width: Number, align: String }], default: [] },
    rows: { type: [mongoose.Schema.Types.Mixed], default: [] },
    /** Path to an array in the context, e.g. "salary.lines". */
    source: { type: String, default: null },

    items: { type: [String], default: [] },

    /** Render only when this condition holds. */
    condition: { type: String, default: null },

    style: {
      fontSize: { type: Number, default: null },
      bold: { type: Boolean, default: false },
      italic: { type: Boolean, default: false },
      align: { type: String, enum: ["left", "center", "right", "justify"], default: "left" },
      colour: { type: String, default: null },
      marginTop: { type: Number, default: null },
      marginBottom: { type: Number, default: null },
    },

    height: { type: Number, default: null },
    fileId: { type: mongoose.Schema.Types.ObjectId, ref: "StoredFile", default: null },
  },
  { _id: true }
);

const documentTemplateSchema = createTenantSchema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true, uppercase: true },
  description: { type: String, default: "" },

  category: {
    type: String,
    enum: [
      "offer_letter",
      "appointment_letter",
      "experience_certificate",
      "relieving_letter",
      "salary_slip",
      "salary_certificate",
      "leave_approval",
      "warning_letter",
      "increment_letter",
      "promotion_letter",
      "confirmation_letter",
      "id_card",
      "attendance_report",
      "custom",
    ],
    default: "custom",
    index: true,
  },

  /** Which context the renderer assembles for this template. */
  contextType: {
    type: String,
    enum: ["employee", "payslip", "leave_request", "organization"],
    default: "employee",
  },

  page: {
    size: { type: String, enum: ["A4", "LETTER", "LEGAL"], default: "A4" },
    orientation: { type: String, enum: ["portrait", "landscape"], default: "portrait" },
    margins: {
      top: { type: Number, default: 60 },
      bottom: { type: Number, default: 60 },
      left: { type: Number, default: 50 },
      right: { type: Number, default: 50 },
    },
  },

  header: {
    enabled: { type: Boolean, default: true },
    showLogo: { type: Boolean, default: true },
    showCompanyName: { type: Boolean, default: true },
    showAddress: { type: Boolean, default: true },
    text: { type: String, default: "" },
    useLetterhead: { type: Boolean, default: false },
  },

  footer: {
    enabled: { type: Boolean, default: true },
    text: { type: String, default: "" },
    showPageNumbers: { type: Boolean, default: true },
    showGeneratedOn: { type: Boolean, default: false },
  },

  watermark: {
    enabled: { type: Boolean, default: false },
    text: { type: String, default: "" },
    opacity: { type: Number, default: 0.08, min: 0.01, max: 0.5 },
  },

  blocks: { type: [blockSchema], default: [] },

  /** Numbering for generated documents, e.g. "OL/{{year}}/{{seq}}". */
  numbering: {
    enabled: { type: Boolean, default: false },
    prefix: { type: String, default: "" },
    nextNumber: { type: Number, default: 1 },
    padding: { type: Number, default: 4 },
  },

  isSystem: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true, index: true },
});

tenantUnique(documentTemplateSchema, "code");

const DocumentTemplate = mongoose.model("DocumentTemplate", documentTemplateSchema);

/** A document attached to an employee, uploaded or generated. */
const employeeDocumentSchema = createTenantSchema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true, index: true },

  name: { type: String, required: true, trim: true },
  category: {
    type: String,
    enum: ["identity", "employment", "education", "salary", "certificate", "company", "medical", "other"],
    default: "other",
    index: true,
  },

  fileId: { type: mongoose.Schema.Types.ObjectId, ref: "StoredFile", required: true },

  documentNumber: { type: String, default: "" },
  issuedOn: { type: Date, default: null },
  expiresOn: { type: Date, default: null, index: true },

  status: {
    type: String,
    enum: ["pending_review", "verified", "rejected", "expired"],
    default: "pending_review",
    index: true,
  },
  verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  verifiedAt: { type: Date, default: null },
  rejectionReason: { type: String, default: "" },

  /** Set when the document came out of a template. */
  templateId: { type: mongoose.Schema.Types.ObjectId, ref: "DocumentTemplate", default: null },
  generatedAt: { type: Date, default: null },

  /** Newer versions supersede older ones without deleting them. */
  version: { type: Number, default: 1 },
  supersedesId: { type: mongoose.Schema.Types.ObjectId, ref: "EmployeeDocument", default: null },
  isLatest: { type: Boolean, default: true },

  /** Whether the employee can see it in their portal. */
  visibleToEmployee: { type: Boolean, default: true },

  notes: { type: String, default: "" },
  expiryRemindersSent: { type: [Number], default: [] },
});

employeeDocumentSchema.index({ organizationId: 1, employeeId: 1, category: 1 });
employeeDocumentSchema.index({ organizationId: 1, expiresOn: 1, status: 1 });

const EmployeeDocument = mongoose.model("EmployeeDocument", employeeDocumentSchema);

module.exports = { DocumentTemplate, EmployeeDocument };
