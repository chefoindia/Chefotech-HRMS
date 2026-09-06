"use strict";

const express = require("express");
const { z } = require("zod");
const service = require("./payroll.service");
const engine = require("./payrollEngine");
const { SalaryComponent, SalaryStructure } = require("./payroll.model");
const { createCrudService, createCrudController } = require("../../shared/crudFactory");
const { authenticate } = require("../auth/authenticate");
const { requirePermission, requireAnyPermission } = require("../../core/rbac/authorize");
const { requireFeature } = require("../organizations/planGuard");
const { FEATURES } = require("../organizations/plans");
const { validate } = require("../../core/validation/validate");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { objectId, objectIdParam, dateString, listQuery } = require("../../core/validation/common");
const { ok, created, accepted, paged } = require("../../core/http/response");
const { AppError } = require("../../core/errors/AppError");
const queue = require("../../core/jobs/queue");
const formula = require("../../core/rules/formula");
const organizationService = require("../organizations/organization.service");

const {
  ComponentSchema,
  StructureSchema,
} = require("./payroll.schema");

/** Reject an unparseable formula at save time, not during a payroll run. */
async function validateFormulas(data) {
  const calc = data.calculation;
  if (calc && calc.method === "formula" && calc.expression) {
    const codes = (await SalaryComponent.find({}).select("code").lean()).map((c) => c.code);
    const check = formula.validateExpression(calc.expression, engine.availableVariables(codes));
    if (!check.valid) {
      throw AppError.validation([
        {
          field: "calculation.expression",
          message:
            check.error ||
            `Unknown ${check.unknownVariables.length ? `variable(s): ${check.unknownVariables.join(", ")}` : `function(s): ${check.unknownFunctions.join(", ")}`}`,
        },
      ]);
    }
  }
  return data;
}

const componentService = createCrudService({
  model: SalaryComponent,
  entityType: "SalaryComponent",
  searchFields: ["name", "code"],
  defaultSort: "order",
  allowedSort: ["name", "order", "type", "createdAt"],
  buildFilter: (query) => (query.type ? { type: query.type } : {}),
  beforeCreate: validateFormulas,
  beforeUpdate: (data) => validateFormulas(data),
  async afterCreate() {
    await organizationService.markStepCompleteIfPending("payroll");
  },
});

const structureService = createCrudService({
  model: SalaryStructure,
  entityType: "SalaryStructure",
  searchFields: ["name", "code"],
  populate: { path: "components.componentId", select: "name code type category order" },
});

const componentController = createCrudController(componentService);
const structureController = createCrudController(structureService);

const router = express.Router();
router.use(authenticate());
router.use(requireFeature(FEATURES.PAYROLL));

// ── Self service ────────────────────────────────────────────────────────────

router.get(
  "/me/payslips",
  requirePermission("payroll.view_own_payslip"),
  asyncHandler(async (req, res) => {
    if (!req.auth.employeeId) throw AppError.notFound("Your employee record");
    return ok(res, await service.myPayslips(req.auth.employeeId, req.query));
  })
);

router.get(
  "/payslips/:id",
  requireAnyPermission("payroll.view_own_payslip", "payroll.view"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => ok(res, await service.getPayslip(req.params.id, req.auth)))
);

/**
 * The payslip as a PDF.
 *
 * Exists because an employee needs a document they can hand to a bank or a
 * landlord, and a screen full of numbers is not that. Rendered on demand from
 * the organization's own payslip template rather than stored, so it always
 * carries current branding and there is no second copy to keep in step if a
 * figure is corrected.
 *
 * `getPayslip` performs the authorisation: it returns not-found unless the
 * payslip is the caller's own or they hold `payroll.view`. Doing the check
 * there rather than here means the JSON and the PDF cannot drift apart on who
 * is allowed to see what.
 */
router.get(
  "/payslips/:id/pdf",
  requireAnyPermission("payroll.view_own_payslip", "payroll.view"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => {
    const payslip = await service.getPayslip(req.params.id, req.auth);

    // An unpublished payslip is a draft that payroll has not signed off. It
    // must not leave the building as a document.
    if (payslip.status !== "published") {
      throw AppError.notFound("Payslip");
    }

    const documents = require("../documents/document.service");
    const { buffer, fileName } = await documents.generateForPayslip(payslip, req);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Length", String(buffer.length));
    return res.send(buffer);
  })
);

// ── Components ──────────────────────────────────────────────────────────────

router.get(
  "/components",
  requireAnyPermission("payroll.manage_components", "payroll.view"),
  validate({ query: listQuery({ type: z.string().optional() }) }),
  asyncHandler(componentController.list)
);

/** Variables a formula may reference, for the editor. */
router.get(
  "/components/variables",
  requirePermission("payroll.manage_components"),
  asyncHandler(async (_req, res) => {
    const codes = (await SalaryComponent.find({ isActive: true }).select("code name").lean()).map(
      (c) => ({ code: c.code, name: c.name })
    );
    return ok(res, {
      systemVariables: engine.availableVariables().map((v) => ({ code: v, name: v })),
      componentVariables: codes,
      functions: Object.keys(formula.FUNCTIONS),
    });
  })
);

router.post(
  "/components",
  requirePermission("payroll.manage_components"),
  validate({ body: ComponentSchema }),
  asyncHandler(componentController.create)
);

router.patch(
  "/components/:id",
  requirePermission("payroll.manage_components"),
  validate({ params: objectIdParam(), body: ComponentSchema.partial() }),
  asyncHandler(componentController.update)
);

router.delete(
  "/components/:id",
  requirePermission("payroll.manage_components"),
  validate({ params: objectIdParam() }),
  asyncHandler(componentController.remove)
);

// ── Structures ──────────────────────────────────────────────────────────────

router.get(
  "/structures",
  requireAnyPermission("payroll.manage_structures", "payroll.view"),
  validate({ query: listQuery() }),
  asyncHandler(structureController.list)
);
router.get(
  "/structures/:id",
  requireAnyPermission("payroll.manage_structures", "payroll.view"),
  validate({ params: objectIdParam() }),
  asyncHandler(structureController.get)
);
router.post(
  "/structures",
  requirePermission("payroll.manage_structures"),
  validate({ body: StructureSchema }),
  asyncHandler(structureController.create)
);
router.patch(
  "/structures/:id",
  requirePermission("payroll.manage_structures"),
  validate({ params: objectIdParam(), body: StructureSchema.partial() }),
  asyncHandler(structureController.update)
);
router.delete(
  "/structures/:id",
  requirePermission("payroll.manage_structures"),
  validate({ params: objectIdParam() }),
  asyncHandler(structureController.remove)
);

// ── Salary assignment ───────────────────────────────────────────────────────

router.get(
  "/salary/:employeeId",
  requirePermission("payroll.view"),
  validate({ params: objectIdParam("employeeId") }),
  asyncHandler(async (req, res) => ok(res, await service.salaryHistory(req.params.employeeId, req.auth)))
);

router.post(
  "/salary/:employeeId",
  requirePermission("payroll.assign_salary"),
  validate({
    params: objectIdParam("employeeId"),
    body: z.object({
      structureId: objectId(),
      effectiveFrom: dateString(),
      ctcAnnual: z.number().min(0).max(1_000_000_000),
      ctcMonthly: z.number().min(0).optional(),
      componentAmounts: z.record(z.number()).optional(),
      paymentMode: z.enum(["bank_transfer", "cheque", "cash", "upi"]).optional(),
      revisionReason: z.string().max(300).optional(),
      revisionType: z.enum(["initial", "increment", "promotion", "correction", "restructure"]).optional(),
    }),
  }),
  asyncHandler(async (req, res) =>
    created(res, await service.assignSalary(req.params.employeeId, req.body, req))
  )
);

// ── Periods ─────────────────────────────────────────────────────────────────

router.get(
  "/periods",
  requirePermission("payroll.view"),
  asyncHandler(async (req, res) => ok(res, await service.listPeriods(req.query)))
);

// ── Runs ────────────────────────────────────────────────────────────────────

router.get(
  "/runs",
  requirePermission("payroll.view"),
  validate({ query: listQuery({ periodId: objectId().optional(), status: z.string().optional() }) }),
  asyncHandler(async (req, res) => {
    const result = await service.listRuns(req.query);
    return paged(res, result.items, result);
  })
);

router.get(
  "/runs/:id",
  requirePermission("payroll.view"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => ok(res, await service.getRun(req.params.id)))
);

router.get(
  "/runs/:id/items",
  requirePermission("payroll.view"),
  validate({ params: objectIdParam(), query: listQuery({ status: z.string().optional() }) }),
  asyncHandler(async (req, res) => {
    const result = await service.listItems(req.params.id, req.query);
    return paged(res, result.items, result);
  })
);

router.post(
  "/runs",
  requirePermission("payroll.process"),
  validate({
    body: z.object({
      year: z.number().int().min(2000).max(2100),
      month: z.number().int().min(1).max(12),
      type: z.enum(["regular", "supplementary", "bonus", "arrear"]).optional(),
      scope: z
        .object({
          departmentIds: z.array(objectId()).optional(),
          locationIds: z.array(objectId()).optional(),
          employeeIds: z.array(objectId()).optional(),
        })
        .optional(),
      notes: z.string().max(500).optional(),
    }),
  }),
  asyncHandler(async (req, res) => created(res, await service.createRun(req.body, req)))
);

/**
 * Processing a run touches every employee, so it goes to the job queue rather
 * than holding an HTTP connection open for a 900-person organization.
 */
router.post(
  "/runs/:id/process",
  requirePermission("payroll.process"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => {
    const job = await queue.enqueue(
      "payroll.process-run",
      { runId: req.params.id },
      { priority: 10, idempotencyKey: `payroll-run-${req.params.id}` }
    );
    return accepted(res, {
      queued: true,
      jobId: String(job._id),
      message: "Payroll is being calculated. This page will update when it finishes.",
    });
  })
);

router.post(
  "/runs/:id/approve",
  requirePermission("payroll.approve"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => ok(res, await service.approveRun(req.params.id, req)))
);

router.post(
  "/runs/:id/lock",
  requirePermission("payroll.lock"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => ok(res, await service.lockRun(req.params.id, req)))
);

router.post(
  "/runs/:id/publish",
  requirePermission("payroll.publish_payslips"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => ok(res, await service.publishPayslips(req.params.id, req)))
);

// ── Items ───────────────────────────────────────────────────────────────────

router.get(
  "/items/:id",
  requireAnyPermission("payroll.view", "payroll.view_own_payslip"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => ok(res, await service.getItem(req.params.id, req.auth)))
);

router.post(
  "/items/:id/adjustments",
  requirePermission("payroll.process"),
  validate({
    params: objectIdParam(),
    body: z.object({
      label: z.string().trim().min(1).max(60),
      type: z.enum(["earning", "deduction"]),
      amount: z.number().min(0).max(100_000_000),
      reason: z.string().max(300).optional(),
    }),
  }),
  asyncHandler(async (req, res) => ok(res, await service.addAdjustment(req.params.id, req.body, req)))
);

// ── Payroll inputs: what the next run will pick up ──────────────────────────
// Loan instalments, approved claims, encashments and one-off bonuses all
// arrive here and wait for a run. HR can see the queue and add to it.

const inputs = require("./inputs.service");

router.get(
  "/inputs",
  requirePermission("payroll.view"),
  validate({
    query: listQuery({
      employeeId: objectId().optional(),
      status: z.enum(["pending", "applied", "cancelled"]).optional(),
      sourceType: z.string().max(30).optional(),
      periodKey: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await inputs.list(req.query);
    return paged(res, result.items, result);
  })
);

router.post(
  "/inputs",
  requirePermission("payroll.process"),
  validate({
    body: z.object({
      employeeId: objectId(),
      type: z.enum(["earning", "deduction"]),
      label: z.string().trim().min(1).max(120),
      amount: z.number().positive().max(100_000_000),
      reason: z.string().max(500).optional(),
      periodKey: z.string().regex(/^\d{4}-\d{2}$/).nullable().optional(),
    }),
  }),
  asyncHandler(async (req, res) => created(res, inputs.shape((await inputs.add(req.body, req)).toObject())))
);

router.post(
  "/inputs/:id/cancel",
  requirePermission("payroll.process"),
  validate({ params: objectIdParam(), body: z.object({ reason: z.string().max(300).optional() }).optional() }),
  asyncHandler(async (req, res) => ok(res, inputs.shape((await inputs.cancel(req.params.id, (req.body || {}).reason, req)).toObject())))
);

module.exports = router;
