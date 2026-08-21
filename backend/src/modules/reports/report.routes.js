"use strict";

const express = require("express");
const { z } = require("zod");
const ExcelJS = require("exceljs");
const { REPORTS, REPORTS_BY_ID } = require("./reportDefinitions");
const { authenticate } = require("../auth/authenticate");
const { requirePermission, hasPermission } = require("../../core/rbac/authorize");
const { validate } = require("../../core/validation/validate");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { objectId, dateString } = require("../../core/validation/common");
const { ok } = require("../../core/http/response");
const { AppError } = require("../../core/errors/AppError");
const { heavyLimiter } = require("../../core/security/rateLimit");
const attendanceService = require("../attendance/attendance.service");
const audit = require("../../core/audit/audit.service");

/**
 * Report execution and export.
 *
 * One route runs every report; the definition supplies the columns, the
 * filters and the permission. Export formatting lives here so a report never
 * has to know whether it is being rendered as JSON, XLSX or CSV.
 */

const FilterSchema = z.object({
  fromDate: dateString().optional(),
  toDate: dateString().optional(),
  departmentId: objectId().optional(),
  locationId: objectId().optional(),
  designationId: objectId().optional(),
  employeeId: objectId().optional(),
  leaveTypeId: objectId().optional(),
  deviceId: objectId().optional(),
  runId: objectId().optional(),
  status: z.string().max(40).optional(),
  employmentType: z.string().max(40).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  format: z.enum(["json", "xlsx", "csv"]).optional(),
  limit: z.coerce.number().int().min(1).max(100000).optional(),
});

const router = express.Router();
router.use(authenticate());

/** The catalog, filtered to what this caller may actually run. */
router.get(
  "/",
  requirePermission("report.view"),
  asyncHandler(async (req, res) =>
    ok(
      res,
      REPORTS.filter((r) => hasPermission(req, r.permission)).map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        category: r.category,
        filters: r.filters,
        columns: r.columns,
        requiresDateRange: Boolean(r.requiresDateRange),
        requiresRun: Boolean(r.requiresRun),
      }))
    )
  )
);

router.get(
  "/:id/run",
  requirePermission("report.view"),
  validate({ params: z.object({ id: z.string().max(60) }), query: FilterSchema }),
  asyncHandler(async (req, res) => {
    const definition = REPORTS_BY_ID[req.params.id];
    if (!definition) throw AppError.notFound("Report");

    if (!hasPermission(req, definition.permission)) {
      throw AppError.forbidden(`You do not have permission to run the ${definition.name}.`);
    }

    if (definition.requiresDateRange && (!req.query.fromDate || !req.query.toDate)) {
      throw AppError.validation([
        { field: "fromDate", message: "This report needs a date range" },
      ]);
    }
    if (definition.requiresRun && !req.query.runId) {
      throw AppError.validation([{ field: "runId", message: "Choose a payroll run" }]);
    }

    // A wide-open date range on a large tenant is how a report becomes an
    // outage. Cap it rather than letting it run for minutes.
    if (req.query.fromDate && req.query.toDate) {
      const days = require("../../shared/datetime").daysBetween(req.query.fromDate, req.query.toDate);
      if (days > 400) {
        throw AppError.badRequest("Reports are limited to a range of 400 days.");
      }
    }

    const context = { timezone: await attendanceService.organizationTimezone(), auth: req.auth };
    const rows = await definition.run(req.query, context);

    const format = req.query.format || "json";

    if (format === "json") {
      const limit = req.query.limit || 5000;
      return ok(res, {
        id: definition.id,
        name: definition.name,
        columns: definition.columns,
        rows: rows.slice(0, limit),
        total: rows.length,
        truncated: rows.length > limit,
        generatedAt: new Date(),
      });
    }

    if (!hasPermission(req, "report.export")) {
      throw AppError.forbidden("You do not have permission to export reports.");
    }

    await audit.record(
      {
        action: "report.exported",
        entityType: "Report",
        entityLabel: definition.name,
        after: { format, rows: rows.length, filters: sanitiseFilters(req.query) },
        severity: "notice",
      },
      req
    );

    if (format === "csv") {
      const csv = toCsv(definition.columns, rows);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${definition.id}-${today()}.csv"`);
      // The BOM makes Excel open UTF-8 correctly instead of mangling names.
      return res.send(`﻿${csv}`);
    }

    const buffer = await toXlsx(definition, rows, req.auth);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${definition.id}-${today()}.xlsx"`);
    return res.send(buffer);
  })
);

/** Exports are rate limited separately: they are the expensive endpoint. */
router.use(heavyLimiter);

function toCsv(columns, rows) {
  const escape = (value) => {
    if (value === null || value === undefined) return "";
    const text = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
    // Neutralise formula injection: a cell starting with = or + is executed by
    // Excel when the file is opened.
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };

  const header = columns.map((c) => escape(c.label)).join(",");
  const body = rows.map((row) => columns.map((c) => escape(row[c.key])).join(",")).join("\n");
  return `${header}\n${body}`;
}

async function toXlsx(definition, rows, auth) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Chefotech HRMS";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(definition.name.slice(0, 30));

  sheet.columns = definition.columns.map((c) => ({
    header: c.label,
    key: c.key,
    width: c.width || 18,
  }));

  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FF1F2937" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF2FF" } };
  header.alignment = { vertical: "middle" };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  for (const row of rows) {
    const added = sheet.addRow(row);
    for (const column of definition.columns) {
      const cell = added.getCell(column.key);
      if (column.type === "money") cell.numFmt = "#,##0.00";
      if (column.type === "number") cell.numFmt = "0.##";
      if (column.type === "date" && cell.value) cell.numFmt = "dd-mmm-yyyy";
      // Same formula-injection guard as the CSV path.
      if (typeof cell.value === "string" && /^[=+\-@]/.test(cell.value)) {
        cell.value = `'${cell.value}`;
      }
    }
  }

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: definition.columns.length },
  };

  const meta = workbook.addWorksheet("About");
  meta.columns = [
    { header: "Field", key: "field", width: 22 },
    { header: "Value", key: "value", width: 50 },
  ];
  meta.getRow(1).font = { bold: true };
  meta.addRow({ field: "Report", value: definition.name });
  meta.addRow({ field: "Organization", value: auth.organization ? auth.organization.name : "" });
  meta.addRow({ field: "Generated on", value: new Date().toLocaleString("en-GB") });
  meta.addRow({ field: "Generated by", value: auth.name || auth.email });
  meta.addRow({ field: "Rows", value: rows.length });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function sanitiseFilters(query) {
  const { format, limit, ...filters } = query;
  return filters;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = router;
