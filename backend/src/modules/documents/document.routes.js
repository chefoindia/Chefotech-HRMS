"use strict";

const express = require("express");
const { z } = require("zod");
const service = require("./document.service");
const { authenticate } = require("../auth/authenticate");
const { requirePermission, requireAnyPermission } = require("../../core/rbac/authorize");
const { validate } = require("../../core/validation/validate");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { uploadSingle } = require("../../core/http/upload");
const { objectId, objectIdParam, dateString } = require("../../core/validation/common");
const { ok, created } = require("../../core/http/response");
const { AppError } = require("../../core/errors/AppError");
const { jsonTransform } = require("../../core/tenancy/baseSchema");

const BlockSchema = z.object({
  type: z.enum([
    "heading", "paragraph", "spacer", "divider", "table",
    "key_values", "signature", "page_break", "image", "list",
  ]),
  text: z.string().max(5000).optional(),
  columns: z
    .array(z.object({ key: z.string(), label: z.string(), width: z.number().optional(), align: z.string().optional() }))
    .optional(),
  rows: z.array(z.any()).optional(),
  source: z.string().max(80).nullable().optional(),
  items: z.array(z.string().max(500)).optional(),
  condition: z.string().max(300).nullable().optional(),
  style: z
    .object({
      fontSize: z.number().min(6).max(48).nullable().optional(),
      bold: z.boolean().optional(),
      italic: z.boolean().optional(),
      align: z.enum(["left", "center", "right", "justify"]).optional(),
      colour: z.string().max(9).nullable().optional(),
      marginTop: z.number().nullable().optional(),
      marginBottom: z.number().nullable().optional(),
    })
    .optional(),
  height: z.number().nullable().optional(),
  fileId: objectId().nullable().optional(),
});

const TemplateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  code: z.string().trim().min(1).max(30),
  description: z.string().max(300).optional(),
  category: z
    .enum([
      "offer_letter", "appointment_letter", "experience_certificate", "relieving_letter",
      "salary_slip", "salary_certificate", "leave_approval", "warning_letter",
      "increment_letter", "promotion_letter", "confirmation_letter", "id_card",
      "attendance_report", "custom",
    ])
    .optional(),
  contextType: z.enum(["employee", "payslip", "leave_request", "organization"]).optional(),
  page: z
    .object({
      size: z.enum(["A4", "LETTER", "LEGAL"]).optional(),
      orientation: z.enum(["portrait", "landscape"]).optional(),
      margins: z
        .object({
          top: z.number().min(0).max(200).optional(),
          bottom: z.number().min(0).max(200).optional(),
          left: z.number().min(0).max(200).optional(),
          right: z.number().min(0).max(200).optional(),
        })
        .optional(),
    })
    .optional(),
  header: z
    .object({
      enabled: z.boolean().optional(),
      showLogo: z.boolean().optional(),
      showCompanyName: z.boolean().optional(),
      showAddress: z.boolean().optional(),
      text: z.string().max(500).optional(),
      useLetterhead: z.boolean().optional(),
    })
    .optional(),
  footer: z
    .object({
      enabled: z.boolean().optional(),
      text: z.string().max(500).optional(),
      showPageNumbers: z.boolean().optional(),
      showGeneratedOn: z.boolean().optional(),
    })
    .optional(),
  watermark: z
    .object({
      enabled: z.boolean().optional(),
      text: z.string().max(60).optional(),
      opacity: z.number().min(0.01).max(0.5).optional(),
    })
    .optional(),
  blocks: z.array(BlockSchema).max(200).optional(),
  numbering: z
    .object({
      enabled: z.boolean().optional(),
      prefix: z.string().max(20).optional(),
      nextNumber: z.number().int().min(1).optional(),
      padding: z.number().int().min(1).max(10).optional(),
    })
    .optional(),
  isActive: z.boolean().optional(),
});

const router = express.Router();
router.use(authenticate());

// ── Templates ───────────────────────────────────────────────────────────────

router.get(
  "/templates",
  requireAnyPermission("document.manage_templates", "document.generate"),
  asyncHandler(async (req, res) => {
    // listTemplates/getTemplate return plain .lean() objects for internal
    // reuse elsewhere in this module (generate() needs the real _id to
    // increment a numbering counter) — the schema's _id-to-id transform only
    // runs on a live Mongoose document, so it is applied by hand here, at
    // the HTTP boundary, rather than inside the service function.
    const templates = await service.listTemplates(req.query);
    return ok(res, templates.map((t) => jsonTransform(null, t)));
  })
);

router.post(
  "/templates/seed-defaults",
  requirePermission("document.manage_templates"),
  asyncHandler(async (req, res) => ok(res, await service.seedDefaultTemplates(req)))
);

router.get(
  "/templates/:id",
  requireAnyPermission("document.manage_templates", "document.generate"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => ok(res, jsonTransform(null, await service.getTemplate(req.params.id))))
);

router.post(
  "/templates",
  requirePermission("document.manage_templates"),
  validate({ body: TemplateSchema }),
  asyncHandler(async (req, res) => created(res, await service.createTemplate(req.body, req)))
);

router.patch(
  "/templates/:id",
  requirePermission("document.manage_templates"),
  validate({ params: objectIdParam(), body: TemplateSchema.partial() }),
  asyncHandler(async (req, res) => ok(res, await service.updateTemplate(req.params.id, req.body, req)))
);

router.delete(
  "/templates/:id",
  requirePermission("document.manage_templates"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => ok(res, await service.deleteTemplate(req.params.id, req)))
);

/** The variables a template author may use, for the editor's helper panel. */
router.get(
  "/templates/:id/variables",
  requirePermission("document.manage_templates"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => {
    const template = await service.getTemplate(req.params.id);
    const Employee = require("../employees/employee.model");
    const sample = await Employee.findOne({ status: "active" }).select("_id").lean();
    if (!sample) {
      return ok(res, { variables: [], note: "Add an employee to see the available variables." });
    }
    const context = await service.buildContext(template, { employeeId: sample._id });
    return ok(res, { variables: flatten(context) });
  })
);

// ── Generation ──────────────────────────────────────────────────────────────

/** Render and stream without storing — the preview button. */
router.post(
  "/generate/preview",
  requirePermission("document.generate"),
  validate({
    body: z.object({
      templateId: objectId(),
      employeeId: objectId().optional(),
      payslipId: objectId().optional(),
      leaveRequestId: objectId().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { templateId, ...params } = req.body;
    const { buffer, fileName } = await service.generate(templateId, params, req);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
    return res.send(buffer);
  })
);

/** Render and attach to the employee's document list. */
router.post(
  "/generate",
  requirePermission("document.generate"),
  validate({
    body: z.object({
      templateId: objectId(),
      employeeId: objectId(),
      payslipId: objectId().optional(),
      leaveRequestId: objectId().optional(),
      visibleToEmployee: z.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { templateId, ...params } = req.body;
    return created(res, await service.generateAndStore(templateId, params, req));
  })
);

// ── Employee documents ──────────────────────────────────────────────────────

router.get(
  "/expiring",
  requirePermission("document.view"),
  asyncHandler(async (req, res) =>
    ok(res, await service.expiring(Number(req.query.withinDays) || 30))
  )
);

router.get(
  "/employee/:employeeId",
  requireAnyPermission("document.view", "document.view_own"),
  validate({ params: objectIdParam("employeeId") }),
  asyncHandler(async (req, res) =>
    ok(res, await service.listEmployeeDocuments(req.params.employeeId, req.auth, req.query))
  )
);

router.get(
  "/me",
  requirePermission("document.view_own"),
  asyncHandler(async (req, res) => {
    if (!req.auth.employeeId) throw AppError.notFound("Your employee record");
    return ok(res, await service.listEmployeeDocuments(req.auth.employeeId, req.auth, req.query));
  })
);

router.post(
  "/employee/:employeeId",
  requirePermission("document.upload"),
  validate({ params: objectIdParam("employeeId") }),
  uploadSingle("file"),
  validate({
    body: z.object({
      name: z.string().max(120).optional(),
      category: z
        .enum(["identity", "employment", "education", "salary", "certificate", "company", "medical", "other"])
        .optional(),
      documentNumber: z.string().max(60).optional(),
      issuedOn: dateString().nullable().optional(),
      expiresOn: dateString().nullable().optional(),
      visibleToEmployee: z.coerce.boolean().optional(),
      supersedesId: objectId().optional(),
      notes: z.string().max(500).optional(),
    }),
  }),
  asyncHandler(async (req, res) =>
    created(res, await service.uploadEmployeeDocument(req.params.employeeId, req.file, req.body, req))
  )
);

router.post(
  "/:id/review",
  requirePermission("document.view"),
  validate({
    params: objectIdParam(),
    body: z.object({
      status: z.enum(["verified", "rejected"]),
      rejectionReason: z.string().max(300).optional(),
    }),
  }),
  asyncHandler(async (req, res) => ok(res, await service.reviewDocument(req.params.id, req.body, req)))
);

router.delete(
  "/:id",
  requirePermission("document.delete"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => ok(res, await service.deleteDocument(req.params.id, req)))
);

function flatten(object, prefix = "", out = []) {
  for (const [key, value] of Object.entries(object || {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
      flatten(value, path, out);
    } else {
      out.push({
        path: `{{${path}}}`,
        example: Array.isArray(value) ? `${value.length} item(s)` : String(value === null || value === undefined ? "" : value).slice(0, 60),
      });
    }
  }
  return out;
}

module.exports = router;
