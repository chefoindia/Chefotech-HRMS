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

const {
  BlockSchema,
  TemplateSchema,
} = require("./document.schema");

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
