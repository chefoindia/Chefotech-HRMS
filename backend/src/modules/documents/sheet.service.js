"use strict";

const SheetTemplate = require("./sheetTemplate.model");
const sources = require("./sheetSources");
const renderer = require("./sheetRenderer");
const defaults = require("./defaultSheets");
const Organization = require("../organizations/organization.model");
const { PayrollRun, PayrollPeriod } = require("../payroll/payroll.model");
const settings = require("../../core/settings/settings.service");
const { AppError } = require("../../core/errors/AppError");
const audit = require("../../core/audit/audit.service");
const tenant = require("../../core/tenancy/tenantContext");
const dt = require("../../shared/datetime");

/**
 * Sheet templates: the designable spreadsheets.
 */

async function seedDefaults() {
  const existing = await SheetTemplate.find({}).select("code").lean();
  const have = new Set(existing.map((t) => t.code));
  const toCreate = defaults.SHEETS.filter((s) => !have.has(s.code)).map((s) => ({
    ...s,
    organizationId: tenant.requireOrganizationId(),
    isSystem: true,
  }));
  if (toCreate.length) await SheetTemplate.insertMany(toCreate);
  return { created: toCreate.length };
}

async function list(query = {}) {
  const filter = {};
  if (query.source) filter.source = query.source;
  if (query.isActive !== undefined) filter.isActive = query.isActive !== "false";
  const rows = await SheetTemplate.find(filter).sort({ name: 1 }).lean();
  return rows.map(shape);
}

async function get(id) {
  const template = await SheetTemplate.findById(id).lean();
  if (!template) throw AppError.notFound("Sheet template");
  return shape(template);
}

function shape(t) {
  return { ...t, id: String(t._id), _id: undefined };
}

async function create(data, req) {
  if (!sources.SOURCES[data.source]) throw AppError.badRequest(`Unknown data source '${data.source}'.`);
  const template = await SheetTemplate.create({ ...data, createdBy: tenant.getUserId() });
  await audit.record(
    { action: "sheettemplate.created", entityType: "SheetTemplate", entityId: template._id, entityLabel: template.name, severity: "notice" },
    req
  );
  return shape(template.toObject());
}

async function update(id, data, req) {
  const template = await SheetTemplate.findById(id);
  if (!template) throw AppError.notFound("Sheet template");
  if (data.source && !sources.SOURCES[data.source]) throw AppError.badRequest(`Unknown data source '${data.source}'.`);
  const before = { name: template.name, columns: (template.columns || []).length };
  Object.assign(template, data, { updatedBy: tenant.getUserId() });
  await template.save();
  await audit.record(
    { action: "sheettemplate.updated", entityType: "SheetTemplate", entityId: template._id, entityLabel: template.name, before, after: { name: template.name, columns: template.columns.length }, skipIfUnchanged: true },
    req
  );
  return shape(template.toObject());
}

async function remove(id, req) {
  const template = await SheetTemplate.findById(id);
  if (!template) throw AppError.notFound("Sheet template");
  if (template.isSystem) {
    template.isActive = false;
    await template.save();
    return { id: String(template._id), deactivated: true };
  }
  await template.softDelete(tenant.getUserId());
  await audit.record(
    { action: "sheettemplate.deleted", entityType: "SheetTemplate", entityId: template._id, entityLabel: template.name, severity: "warning" },
    req
  );
  return { id: String(template._id), deleted: true };
}

/** The catalog of sources, filtered to what the caller may use. */
async function describeSources(auth) {
  const all = await sources.describeSources();
  const permissions = new Set(auth.permissions || []);
  return all.filter((s) => permissions.has(s.permission));
}

async function fieldsFor(sourceKey, filters) {
  return sources.fieldsFor(sourceKey, filters || {});
}

/**
 * Produce the sheet. `format` is xlsx | csv | pdf | json (json is the preview
 * the designer shows: the first rows, already formatted).
 */
async function render(id, { filters = {}, format = "xlsx", limit = null } = {}, auth) {
  const template = await SheetTemplate.findById(id).lean();
  if (!template) throw AppError.notFound("Sheet template");

  const source = sources.SOURCES[template.source];
  if (!source) throw AppError.badRequest(`This sheet uses a data source that no longer exists (${template.source}).`);

  const permissions = new Set(auth.permissions || []);
  if (!permissions.has(source.permission)) {
    throw AppError.forbidden(`You do not have permission to build sheets from ${source.label}.`);
  }
  // Columns that reveal bank or identity data need the sensitive permission
  // even when the base source is allowed.
  if (source.sensitivePermission && !permissions.has(source.sensitivePermission)) {
    const sensitiveKeys = new Set((source.fields || []).filter((f) => f.sensitive).map((f) => f.key));
    const asked = (template.columns || []).filter((c) => !c.hidden && sensitiveKeys.has(c.key));
    if (asked.length) {
      throw AppError.forbidden(`This sheet includes ${asked.map((c) => c.label).join(", ")}, which needs the "view sensitive data" permission.`);
    }
  }

  const merged = { ...(template.filters || {}), ...filters };
  if (source.requiresDateRange && (!merged.fromDate || !merged.toDate)) {
    throw AppError.validation([{ field: "fromDate", message: "This sheet needs a date range" }]);
  }
  if (source.requiresRun && !merged.runId) {
    throw AppError.validation([{ field: "runId", message: "Choose a payroll run" }]);
  }
  if (merged.fromDate && merged.toDate && dt.daysBetween(merged.fromDate, merged.toDate) > 400) {
    throw AppError.badRequest("Sheets are limited to a range of 400 days.");
  }

  const organization = await tenant.runAsSystem(
    () => Organization.findById(tenant.requireOrganizationId()).lean(),
    "sheet.render"
  );
  const dateFormat = await settings.get("org.date_format").catch(() => "DD MMM YYYY");
  const ctx = { timezone: organization.timezone, locale: organization.locale, auth };

  const rows = await source.rows(merged, ctx);

  // A muster roll's columns depend on the period, so its day columns are
  // filled in from the source at render time rather than stored.
  let effective = template;
  if (template.source === "attendance_muster") {
    const dayFields = (await sources.fieldsFor("attendance_muster", merged)).filter((f) => /^D\d\d$/.test(f.key));
    const stored = template.columns || [];
    const insertAt = Math.min(stored.length, stored.findIndex((c) => ["present", "absent", "leave", "weeklyOff", "holiday", "payableDays"].includes(c.key)) === -1 ? stored.length : stored.findIndex((c) => ["present", "absent", "leave", "weeklyOff", "holiday", "payableDays"].includes(c.key)));
    effective = { ...template, columns: [...stored.slice(0, insertAt), ...dayFields.map((f) => ({ key: f.key, label: f.label, width: 4, format: "text", align: "center" })), ...stored.slice(insertAt)] };
  }

  const periodLabel = await describePeriod(merged);
  const meta = {
    company: organization.legalName || organization.name,
    periodLabel,
    generatedOn: dt.nowIn(organization.timezone).format("DD MMM YYYY HH:mm"),
    generatedBy: auth.name || auth.email,
    sourceLabel: source.label,
    filters: describeFilters(merged),
    locale: organization.locale,
    currencySymbol: organization.currencySymbol || "",
    formatDate: (value) => formatDate(value, dateFormat, organization.locale),
  };

  const prepared = renderer.prepare(effective, rows, { meta });
  const stamp = dt.todayString(organization.timezone);
  const base = `${template.code.toLowerCase()}-${stamp}`;

  if (format === "json") {
    const max = limit || 50;
    return {
      columns: prepared.columns,
      groups: prepared.groups.map((g) => ({ label: g.label, rows: g.rows.slice(0, max).map((r) => Object.fromEntries(prepared.columns.map((c) => [c.key, renderer.displayValue(r[c.key], c.format, meta)]))), totals: g.totals })),
      totals: Object.fromEntries(Object.entries(prepared.totals).map(([k, v]) => [k, renderer.displayValue(v, (prepared.columns.find((c) => c.key === k) || {}).format, meta)])),
      rowCount: prepared.rowCount,
      truncated: prepared.rowCount > max,
      meta: { ...meta, formatDate: undefined },
    };
  }

  if (format === "csv") {
    return { buffer: Buffer.from(renderer.toCsv(effective, prepared, meta), "utf8"), fileName: `${base}.csv`, mimeType: "text/csv; charset=utf-8", rowCount: prepared.rowCount };
  }
  if (format === "pdf") {
    return { buffer: await renderer.toPdf(effective, prepared, meta), fileName: `${base}.pdf`, mimeType: "application/pdf", rowCount: prepared.rowCount };
  }
  return {
    buffer: await renderer.toXlsx(effective, prepared, meta),
    fileName: `${base}.xlsx`,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    rowCount: prepared.rowCount,
  };
}

async function describePeriod(filters) {
  if (filters.runId) {
    const run = await PayrollRun.findById(filters.runId).select("periodId runNumber").lean();
    if (run) {
      const period = await PayrollPeriod.findById(run.periodId).select("name").lean();
      if (period) return `${period.name}${run.runNumber > 1 ? ` (run ${run.runNumber})` : ""}`;
    }
  }
  if (filters.fromDate && filters.toDate) {
    return filters.fromDate === filters.toDate ? filters.fromDate : `${filters.fromDate} to ${filters.toDate}`;
  }
  if (filters.year) return `Year ${filters.year}`;
  return "";
}

function describeFilters(filters) {
  const out = {};
  for (const [k, v] of Object.entries(filters || {})) {
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) continue;
    out[k] = Array.isArray(v) ? v.join(", ") : v;
  }
  return out;
}

const DATE_FORMATS = {
  "DD/MM/YYYY": { day: "2-digit", month: "2-digit", year: "numeric" },
  "MM/DD/YYYY": { month: "2-digit", day: "2-digit", year: "numeric" },
  "YYYY-MM-DD": { year: "numeric", month: "2-digit", day: "2-digit" },
  "DD MMM YYYY": { day: "numeric", month: "short", year: "numeric" },
};

function formatDate(value, format, locale) {
  if (!value) return "";
  const s = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return String(value);
  const date = new Date(`${s}T12:00:00Z`);
  if (format === "YYYY-MM-DD") return s;
  return new Intl.DateTimeFormat(format === "MM/DD/YYYY" ? "en-US" : locale || "en-GB", { ...(DATE_FORMATS[format] || DATE_FORMATS["DD MMM YYYY"]), timeZone: "UTC" }).format(date);
}

module.exports = { seedDefaults, list, get, create, update, remove, describeSources, fieldsFor, render, formatDate, SheetTemplate };
