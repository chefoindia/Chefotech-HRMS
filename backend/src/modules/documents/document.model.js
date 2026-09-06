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
 * document service assembles — employee, company, salary, dates. Inline
 * emphasis uses **bold** and _italic_.
 */

const BLOCK_TYPES = [
  "heading",
  "paragraph",
  "list",
  "checklist",
  "spacer",
  "divider",
  "table",
  "key_values",
  "columns",
  "signature",
  "page_break",
  "image",
  "qr",
];

const TEMPLATE_CATEGORIES = [
  "offer_letter",
  "letter_of_intent",
  "appointment_letter",
  "confirmation_letter",
  "probation_extension",
  "increment_letter",
  "promotion_letter",
  "transfer_letter",
  "appraisal_letter",
  "contract_extension",
  "warning_letter",
  "show_cause_notice",
  "termination_letter",
  "resignation_acceptance",
  "relieving_letter",
  "experience_certificate",
  "full_final_settlement",
  "salary_slip",
  "salary_certificate",
  "salary_annexure",
  "bonafide_certificate",
  "address_proof",
  "no_objection_certificate",
  "internship_certificate",
  "training_certificate",
  "leave_approval",
  "id_card",
  "joining_checklist",
  "exit_checklist",
  "attendance_report",
  "custom",
];

const CONTEXT_TYPES = ["employee", "payslip", "leave_request", "exit", "organization"];

const blockSchema = new mongoose.Schema(
  {
    type: { type: String, enum: BLOCK_TYPES, required: true },

    text: { type: String, default: "" },

    /** Headings: 1 is the document title size, 2 and 3 are section sizes. */
    level: { type: Number, default: 1, min: 1, max: 3 },
    underline: { type: Boolean, default: false },

    /** Table and key-value blocks. */
    columns: {
      type: [
        {
          key: String,
          label: String,
          width: Number,
          align: String,
          /** text | number | integer | money | percent | date */
          format: String,
          /** Sum this column in a totals row. */
          total: Boolean,
        },
      ],
      default: [],
    },
    rows: { type: [mongoose.Schema.Types.Mixed], default: [] },
    /** Path to an array in the context, e.g. "salary.lines". */
    source: { type: String, default: null },
    /** Tables: alternate row shading, a numbered first column, the label for the totals row. */
    zebra: { type: Boolean, default: false },
    showIndex: { type: Boolean, default: false },
    totalsLabel: { type: String, default: "" },
    emptyText: { type: String, default: "" },
    headerColour: { type: String, default: null },

    /** Key-value grids: two columns of pairs (default) or one; label and value on one line. */
    layout: { type: String, enum: ["double", "single"], default: "double" },
    inline: { type: Boolean, default: false },

    /** Two-column text block. */
    left: { type: String, default: "" },
    right: { type: String, default: "" },

    items: { type: [String], default: [] },

    /** Render only when this condition holds. */
    condition: { type: String, default: null },

    /** Signature blocks: which side, and an optional stamp/signature image. */
    align: { type: String, enum: ["left", "right"], default: "left" },

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

  category: { type: String, enum: TEMPLATE_CATEGORIES, default: "custom", index: true },

  /** Which context the renderer assembles for this template. */
  contextType: { type: String, enum: CONTEXT_TYPES, default: "employee" },

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
    showContact: { type: Boolean, default: true },
    text: { type: String, default: "" },
    /** Draw the uploaded letterhead image instead of the text header. */
    useLetterhead: { type: Boolean, default: false },
  },

  footer: {
    enabled: { type: Boolean, default: true },
    text: { type: String, default: "" },
    showPageNumbers: { type: Boolean, default: true },
    showGeneratedOn: { type: Boolean, default: false },
    /** A QR code and verification code on every page, checkable publicly. */
    showVerificationQr: { type: Boolean, default: false },
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

  /** Where a generated document lands in the employee's file. */
  storeAs: {
    category: { type: String, default: null },
    visibleToEmployee: { type: Boolean, default: true },
    requireAcknowledgement: { type: Boolean, default: false },
  },

  /** Incremented on every save; each previous state is kept as a version. */
  version: { type: Number, default: 1 },
  tags: { type: [String], default: [] },

  isSystem: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true, index: true },
});

tenantUnique(documentTemplateSchema, "code");

const DocumentTemplate = mongoose.model("DocumentTemplate", documentTemplateSchema);

/** A snapshot of a template as it was before an edit, so edits can be undone. */
const documentTemplateVersionSchema = createTenantSchema(
  {
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: "DocumentTemplate", required: true, index: true },
    version: { type: Number, required: true },
    snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
    note: { type: String, default: "" },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { softDelete: false }
);

documentTemplateVersionSchema.index({ organizationId: 1, templateId: 1, version: -1 });

const DocumentTemplateVersion = mongoose.model("DocumentTemplateVersion", documentTemplateVersionSchema);

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

  /** How it got here. */
  source: { type: String, enum: ["uploaded", "generated", "requested"], default: "uploaded" },

  /** Set when the document came out of a template. */
  templateId: { type: mongoose.Schema.Types.ObjectId, ref: "DocumentTemplate", default: null },
  generatedAt: { type: Date, default: null },
  /** Set when the upload fulfilled a request from HR. */
  requestId: { type: mongoose.Schema.Types.ObjectId, ref: "DocumentRequest", default: null },

  /** Newer versions supersede older ones without deleting them. */
  version: { type: Number, default: 1 },
  supersedesId: { type: mongoose.Schema.Types.ObjectId, ref: "EmployeeDocument", default: null },
  isLatest: { type: Boolean, default: true },

  /** Whether the employee can see it in their portal. */
  visibleToEmployee: { type: Boolean, default: true },

  /**
   * "I have read this." Not a signature in the legal sense — that would need
   * a certificate authority — but a timestamped, IP-stamped, typed-name
   * acknowledgement, which is what most policy and letter workflows need.
   */
  acknowledgement: {
    required: { type: Boolean, default: false },
    requestedAt: { type: Date, default: null },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    dueOn: { type: Date, default: null },
    acknowledgedAt: { type: Date, default: null },
    acknowledgedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    acknowledgedName: { type: String, default: "" },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
    remindersSent: { type: [Date], default: [] },
  },

  /**
   * Public verification of a generated document: the code printed on it and
   * a hash of the bytes as issued, so a copy can be checked without
   * revealing anything about the person it concerns.
   */
  verification: {
    code: { type: String, default: null },
    sha256: { type: String, default: null },
    verifiedCount: { type: Number, default: 0 },
    lastVerifiedAt: { type: Date, default: null },
  },

  notes: { type: String, default: "" },
  expiryRemindersSent: { type: [Number], default: [] },
});

employeeDocumentSchema.index({ organizationId: 1, employeeId: 1, category: 1 });
employeeDocumentSchema.index({ organizationId: 1, expiresOn: 1, status: 1 });
employeeDocumentSchema.index({ organizationId: 1, "acknowledgement.required": 1, "acknowledgement.acknowledgedAt": 1 });
employeeDocumentSchema.index(
  { "verification.code": 1 },
  { unique: true, sparse: true, partialFilterExpression: { "verification.code": { $type: "string" } } }
);

const EmployeeDocument = mongoose.model("EmployeeDocument", employeeDocumentSchema);

/**
 * A document the company publishes to everyone: the handbook, the leave
 * policy, the code of conduct, a circular. Lives apart from the per-employee
 * file because it belongs to nobody in particular and everybody at once.
 */
const companyDocumentSchema = createTenantSchema({
  title: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, default: "", maxlength: 2000 },
  category: {
    type: String,
    enum: ["policy", "handbook", "form", "circular", "procedure", "other"],
    default: "policy",
    index: true,
  },
  fileId: { type: mongoose.Schema.Types.ObjectId, ref: "StoredFile", required: true },
  version: { type: String, default: "1.0" },
  effectiveFrom: { type: Date, default: null },

  audience: {
    type: { type: String, enum: ["all", "departments", "locations"], default: "all" },
    departmentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Department" }],
    locationIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Location" }],
  },

  requireAcknowledgement: { type: Boolean, default: false },
  acknowledgements: {
    type: [
      new mongoose.Schema(
        {
          userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
          employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },
          name: { type: String, default: "" },
          at: { type: Date, default: Date.now },
          ip: { type: String, default: null },
        },
        { _id: false }
      ),
    ],
    default: [],
  },

  isActive: { type: Boolean, default: true, index: true },
  publishedAt: { type: Date, default: Date.now },
});

companyDocumentSchema.index({ organizationId: 1, isActive: 1, category: 1, publishedAt: -1 });

const CompanyDocument = mongoose.model("CompanyDocument", companyDocumentSchema);

/** HR asking an employee to upload something: "your PAN card, by Friday". */
const documentRequestSchema = createTenantSchema({
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  category: {
    type: String,
    enum: ["identity", "employment", "education", "salary", "certificate", "company", "medical", "other"],
    default: "other",
  },
  note: { type: String, default: "", maxlength: 1000 },
  dueOn: { type: Date, default: null },

  status: { type: String, enum: ["pending", "fulfilled", "cancelled"], default: "pending", index: true },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  fulfilledDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: "EmployeeDocument", default: null },
  fulfilledAt: { type: Date, default: null },
  remindersSent: { type: [Date], default: [] },
});

documentRequestSchema.index({ organizationId: 1, status: 1, dueOn: 1 });

const DocumentRequest = mongoose.model("DocumentRequest", documentRequestSchema);

module.exports = {
  DocumentTemplate,
  DocumentTemplateVersion,
  EmployeeDocument,
  CompanyDocument,
  DocumentRequest,
  BLOCK_TYPES,
  TEMPLATE_CATEGORIES,
  CONTEXT_TYPES,
};
