"use strict";

const express = require("express");
const { z } = require("zod");
const AuditLog = require("../../core/audit/auditLog.model");
const { authenticate } = require("../auth/authenticate");
const { requirePermission } = require("../../core/rbac/authorize");
const { validate } = require("../../core/validation/validate");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { objectId, listQuery, dateString } = require("../../core/validation/common");
const { ok, paged } = require("../../core/http/response");
const { parseListQuery } = require("../../core/http/queryOptions");
const tenant = require("../../core/tenancy/tenantContext");
const { heavyLimiter } = require("../../core/security/rateLimit");

/**
 * The audit trail.
 *
 * AuditLog is a global collection (it has to be writable from system contexts),
 * so every read here filters on organizationId explicitly. That filter is not
 * optional and is never taken from the query string.
 */
const router = express.Router();
router.use(authenticate());

function baseFilter(query) {
  const filter = { organizationId: tenant.requireOrganizationId() };

  if (query.action) filter.action = query.action;
  if (query.entityType) filter.entityType = query.entityType;
  if (query.entityId) filter.entityId = query.entityId;
  if (query.actorId) filter.actorId = query.actorId;
  if (query.severity) filter.severity = query.severity;

  if (query.fromDate || query.toDate) {
    filter.occurredAt = {};
    if (query.fromDate) filter.occurredAt.$gte = new Date(`${query.fromDate}T00:00:00.000Z`);
    if (query.toDate) filter.occurredAt.$lte = new Date(`${query.toDate}T23:59:59.999Z`);
  }

  return filter;
}

router.get(
  "/",
  requirePermission("audit.view"),
  validate({
    query: listQuery({
      action: z.string().optional(),
      entityType: z.string().optional(),
      entityId: objectId().optional(),
      actorId: objectId().optional(),
      severity: z.enum(["info", "notice", "warning", "critical"]).optional(),
      fromDate: dateString().optional(),
      toDate: dateString().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parseListQuery(req.query, {
      allowedSort: ["occurredAt"],
      defaultSort: "-occurredAt",
      maxLimit: 200,
    });

    const filter = baseFilter(req.query);

    const [items, total] = await Promise.all([
      AuditLog.find(filter).sort({ occurredAt: -1 }).skip(skip).limit(limit).lean(),
      AuditLog.countDocuments(filter),
    ]);

    return paged(res, items, { page, limit, total });
  })
);

/** Distinct action names, for the filter dropdown. */
router.get(
  "/actions",
  requirePermission("audit.view"),
  asyncHandler(async (_req, res) => {
    const actions = await AuditLog.distinct("action", {
      organizationId: tenant.requireOrganizationId(),
    });
    return ok(res, actions.sort());
  })
);

router.get(
  "/entity/:entityType/:entityId",
  requirePermission("audit.view"),
  validate({
    params: z.object({ entityType: z.string().max(40), entityId: objectId() }),
  }),
  asyncHandler(async (req, res) => {
    const items = await AuditLog.find({
      organizationId: tenant.requireOrganizationId(),
      entityType: req.params.entityType,
      entityId: req.params.entityId,
    })
      .sort({ occurredAt: -1 })
      .limit(200)
      .lean();
    return ok(res, items);
  })
);

router.get(
  "/export",
  requirePermission("audit.export"),
  heavyLimiter,
  validate({
    query: z.object({
      fromDate: dateString(),
      toDate: dateString(),
      entityType: z.string().optional(),
      severity: z.string().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const ExcelJS = require("exceljs");
    const rows = await AuditLog.find(baseFilter(req.query))
      .sort({ occurredAt: -1 })
      .limit(50000)
      .lean();

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Audit trail");
    sheet.columns = [
      { header: "When", key: "occurredAt", width: 22 },
      { header: "Actor", key: "actor", width: 28 },
      { header: "Action", key: "action", width: 30 },
      { header: "Entity", key: "entity", width: 24 },
      { header: "Reference", key: "label", width: 34 },
      { header: "Severity", key: "severity", width: 12 },
      { header: "Changed fields", key: "changed", width: 40 },
      { header: "Description", key: "description", width: 50 },
      { header: "IP", key: "ip", width: 16 },
    ];
    sheet.getRow(1).font = { bold: true };

    for (const row of rows) {
      sheet.addRow({
        occurredAt: row.occurredAt,
        actor: row.actorName || row.actorEmail || row.actorType,
        action: row.action,
        entity: row.entityType,
        label: row.entityLabel || "",
        severity: row.severity,
        changed: (row.changedFields || []).join(", "),
        description: row.description || "",
        ip: row.ip || "",
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="audit-${req.query.fromDate}-to-${req.query.toDate}.xlsx"`
    );
    return res.send(Buffer.from(buffer));
  })
);

module.exports = router;
