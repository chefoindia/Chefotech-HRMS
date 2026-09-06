"use strict";

const express = require("express");
const { z } = require("zod");
const service = require("./document.service");
const { authenticate } = require("../auth/authenticate");
const { requirePermission, requireAnyPermission, hasPermission } = require("../../core/rbac/authorize");
const { validate } = require("../../core/validation/validate");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { uploadSingle } = require("../../core/http/upload");
const { objectId, objectIdParam, nullableDateString, listQuery, boolish } = require("../../core/validation/common");
const { ok, created, paged } = require("../../core/http/response");
const { AppError } = require("../../core/errors/AppError");
const { jsonTransform } = require("../../core/tenancy/baseSchema");
const { heavyLimiter } = require("../../core/security/rateLimit");
const { TemplateSchema, CompanyDocumentSchema, DocumentRequestSchema, DOCUMENT_CATEGORIES } = require("./document.schema");
const { BLOCK_TYPES, TEMPLATE_CATEGORIES, CONTEXT_TYPES } = require("./document.model");

const router = express.Router();
router.use(authenticate());

// ── Templates ───────────────────────────────────────────────────────────────

/** What the designer can offer: block types, categories, contexts. */
router.get(
  "/templates/catalog",
  requireAnyPermission("document.manage_templates", "document.generate"),
  asyncHandler(async (_req, res) =>
    ok(res, { blockTypes: BLOCK_TYPES, categories: TEMPLATE_CATEGORIES, contextTypes: CONTEXT_TYPES, documentCategories: DOCUMENT_CATEGORIES })
  )
);

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
  asyncHandler(async (_req, res) => ok(res, await service.seedDefaultTemplates()))
);

router.post(
  "/templates/import",
  requirePermission("document.manage_templates"),
  validate({ body: z.object({ format: z.string(), formatVersion: z.number().optional(), template: z.record(z.any()) }).passthrough() }),
  asyncHandler(async (req, res) => created(res, await service.importTemplate(req.body, req)))
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
  validate({ params: objectIdParam(), body: TemplateSchema.partial().extend({ changeNote: z.string().max(200).optional() }) }),
  asyncHandler(async (req, res) => {
    const { changeNote, ...body } = req.body;
    return ok(res, await service.updateTemplate(req.params.id, body, req, { note: changeNote || "" }));
  })
);

router.delete(
  "/templates/:id",
  requirePermission("document.manage_templates"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => ok(res, await service.deleteTemplate(req.params.id, req)))
);

router.get(
  "/templates/:id/versions",
  requirePermission("document.manage_templates"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => ok(res, await service.listVersions(req.params.id)))
);

router.get(
  "/templates/:id/versions/:versionId",
  requirePermission("document.manage_templates"),
  validate({ params: z.object({ id: objectId(), versionId: objectId() }) }),
  asyncHandler(async (req, res) => ok(res, await service.getVersion(req.params.id, req.params.versionId)))
);

router.post(
  "/templates/:id/versions/:versionId/restore",
  requirePermission("document.manage_templates"),
  validate({ params: z.object({ id: objectId(), versionId: objectId() }) }),
  asyncHandler(async (req, res) => ok(res, await service.restoreVersion(req.params.id, req.params.versionId, req)))
);

router.get(
  "/templates/:id/export",
  requirePermission("document.manage_templates"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => {
    const payload = await service.exportTemplate(req.params.id);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${payload.template.code.toLowerCase()}.template.json"`);
    return res.send(JSON.stringify(payload, null, 2));
  })
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

/** Render and stream without storing — the preview button. Never numbers. */
router.post(
  "/generate/preview",
  requireAnyPermission("document.generate", "document.manage_templates"),
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
    const { buffer, fileName } = await service.generate(templateId, params, req, { dryRun: true });
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
      requireAcknowledgement: z.boolean().optional(),
      acknowledgementDueOn: nullableDateString(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { templateId, ...params } = req.body;
    return created(res, await service.generateAndStore(templateId, params, req));
  })
);

router.post(
  "/generate/bulk",
  requirePermission("document.generate"),
  heavyLimiter,
  validate({
    body: z.object({
      templateId: objectId(),
      employeeIds: z.array(objectId()).min(1).max(2000),
      visibleToEmployee: z.boolean().optional(),
      requireAcknowledgement: z.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => ok(res, await service.requestBulkGenerate(req.body, req)))
);

router.get(
  "/generate/bulk/downloads",
  requirePermission("document.generate"),
  asyncHandler(async (req, res) => ok(res, await service.listBulkDownloads(req.auth)))
);

router.get(
  "/generate/bulk/:jobId",
  requirePermission("document.generate"),
  validate({ params: objectIdParam("jobId") }),
  asyncHandler(async (req, res) => ok(res, await service.bulkStatus(req.params.jobId)))
);

// ── Company documents (policies, handbooks) ─────────────────────────────────

router.get(
  "/company",
  asyncHandler(async (req, res) => {
    const manage = req.query.scope === "manage" && hasPermission(req, "document.manage_company");
    return ok(res, await service.listCompanyDocuments(req.auth, { manage }));
  })
);

router.post(
  "/company",
  requirePermission("document.manage_company"),
  uploadSingle("file"),
  validate({ body: CompanyDocumentSchema }),
  asyncHandler(async (req, res) => created(res, await service.createCompanyDocument(req.file, req.body, req)))
);

router.patch(
  "/company/:id",
  requirePermission("document.manage_company"),
  validate({ params: objectIdParam(), body: CompanyDocumentSchema.partial() }),
  asyncHandler(async (req, res) => ok(res, await service.updateCompanyDocument(req.params.id, req.body, req)))
);

router.post(
  "/company/:id/file",
  requirePermission("document.manage_company"),
  validate({ params: objectIdParam() }),
  uploadSingle("file"),
  asyncHandler(async (req, res) => ok(res, await service.updateCompanyDocument(req.params.id, {}, req, req.file)))
);

router.post(
  "/company/:id/acknowledge",
  validate({ params: objectIdParam(), body: z.object({ name: z.string().max(120).optional() }).optional() }),
  asyncHandler(async (req, res) => ok(res, await service.acknowledgeCompanyDocument(req.params.id, req.auth, req.body || {}, req)))
);

router.get(
  "/company/:id/acknowledgements",
  requirePermission("document.manage_company"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => ok(res, await service.companyDocumentAcknowledgements(req.params.id)))
);

router.delete(
  "/company/:id",
  requirePermission("document.manage_company"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => ok(res, await service.deleteCompanyDocument(req.params.id, req)))
);

// ── Document requests ───────────────────────────────────────────────────────

router.get(
  "/requests",
  requirePermission("document.view"),
  validate({ query: listQuery({ status: z.enum(["pending", "fulfilled", "cancelled"]).optional(), employeeId: objectId().optional() }) }),
  asyncHandler(async (req, res) => {
    const result = await service.listRequests(req.query);
    return paged(res, result.items, result);
  })
);

router.post(
  "/requests",
  requirePermission("document.upload"),
  validate({ body: DocumentRequestSchema }),
  asyncHandler(async (req, res) => created(res, await service.createRequests(req.body, req)))
);

router.get(
  "/requests/me",
  asyncHandler(async (req, res) => ok(res, await service.myRequests(req.auth)))
);

router.post(
  "/requests/:id/cancel",
  requirePermission("document.upload"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => ok(res, await service.cancelRequest(req.params.id, req)))
);

// ── Acknowledgements (HR view) ──────────────────────────────────────────────

router.get(
  "/acknowledgements/pending",
  requirePermission("document.view"),
  validate({ query: listQuery({ overdue: z.string().optional() }) }),
  asyncHandler(async (req, res) => {
    const result = await service.pendingAcknowledgements(req.query);
    return paged(res, result.items, result);
  })
);

// ── Employee documents ──────────────────────────────────────────────────────

router.get(
  "/expiring",
  requirePermission("document.view"),
  asyncHandler(async (req, res) => ok(res, await service.expiring(Number(req.query.withinDays) || 30)))
);

router.get(
  "/employee/:employeeId",
  requireAnyPermission("document.view", "document.view_own"),
  validate({ params: objectIdParam("employeeId") }),
  asyncHandler(async (req, res) => ok(res, await service.listEmployeeDocuments(req.params.employeeId, req.auth, req.query)))
);

router.get(
  "/me",
  requirePermission("document.view_own"),
  asyncHandler(async (req, res) => {
    if (!req.auth.employeeId) throw AppError.notFound("Your employee record");
    return ok(res, await service.listEmployeeDocuments(req.auth.employeeId, req.auth, req.query));
  })
);

/** An employee uploading to their own file — fulfilling a request, usually. */
router.post(
  "/me",
  requirePermission("document.view_own"),
  uploadSingle("file"),
  validate({
    body: z.object({
      name: z.string().max(120).optional(),
      category: z.enum(DOCUMENT_CATEGORIES).optional(),
      documentNumber: z.string().max(60).optional(),
      issuedOn: nullableDateString(),
      expiresOn: nullableDateString(),
      requestId: objectId().optional(),
      notes: z.string().max(500).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    if (!req.auth.employeeId) throw AppError.notFound("Your employee record");
    return created(res, await service.uploadEmployeeDocument(req.auth.employeeId, req.file, { ...req.body, visibleToEmployee: true }, req));
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
      category: z.enum(DOCUMENT_CATEGORIES).optional(),
      documentNumber: z.string().max(60).optional(),
      issuedOn: nullableDateString(),
      expiresOn: nullableDateString(),
      visibleToEmployee: boolish().optional(),
      supersedesId: objectId().optional(),
      requestId: objectId().optional(),
      notes: z.string().max(500).optional(),
    }),
  }),
  asyncHandler(async (req, res) => created(res, await service.uploadEmployeeDocument(req.params.employeeId, req.file, req.body, req)))
);

router.patch(
  "/:id",
  requirePermission("document.upload"),
  validate({
    params: objectIdParam(),
    body: z.object({
      name: z.string().max(120).optional(),
      category: z.enum(DOCUMENT_CATEGORIES).optional(),
      documentNumber: z.string().max(60).optional(),
      issuedOn: nullableDateString(),
      expiresOn: nullableDateString(),
      visibleToEmployee: z.boolean().optional(),
      notes: z.string().max(500).optional(),
    }),
  }),
  asyncHandler(async (req, res) => ok(res, await service.updateDocument(req.params.id, req.body, req)))
);

router.post(
  "/:id/review",
  requirePermission("document.view"),
  validate({
    params: objectIdParam(),
    body: z.object({ status: z.enum(["verified", "rejected"]), rejectionReason: z.string().max(300).optional() }),
  }),
  asyncHandler(async (req, res) => ok(res, await service.reviewDocument(req.params.id, req.body, req)))
);

router.post(
  "/:id/request-acknowledgement",
  requirePermission("document.upload"),
  validate({ params: objectIdParam(), body: z.object({ dueOn: nullableDateString() }).optional() }),
  asyncHandler(async (req, res) => ok(res, await service.requestAcknowledgement(req.params.id, req.body || {}, req)))
);

router.post(
  "/:id/acknowledge",
  requirePermission("document.view_own"),
  validate({ params: objectIdParam(), body: z.object({ name: z.string().max(120).optional() }).optional() }),
  asyncHandler(async (req, res) => ok(res, await service.acknowledge(req.params.id, req.auth, req.body || {}, req)))
);

router.delete(
  "/:id",
  requirePermission("document.delete"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => ok(res, await service.deleteDocument(req.params.id, req)))
);

function flatten(object, prefix = "", out = []) {
  for (const [key, value] of Object.entries(object || {})) {
    if (key.startsWith("__") || typeof value === "function") continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
      flatten(value, path, out);
    } else {
      out.push({
        path: `{{${path}}}`,
        example: Array.isArray(value)
          ? `${value.length} item(s) — use in a table with source "${path}"`
          : String(value === null || value === undefined ? "" : value).slice(0, 60),
      });
    }
  }
  return out;
}

module.exports = router;
