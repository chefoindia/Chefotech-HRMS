"use strict";

const CustomField = require("./customField.model");
const Employee = require("./employee.model");
const { AppError } = require("../../core/errors/AppError");
const audit = require("../../core/audit/audit.service");
const tenant = require("../../core/tenancy/tenantContext");

/**
 * Custom field definitions, and validation of the values stored against them.
 *
 * The values are Mixed in Mongo, so this file is the only thing standing
 * between a tenant's field definition and garbage in the database. It runs on
 * every employee create/update and every import row.
 */

const definitionCache = new Map(); // orgId -> { definitions, expiresAt }
const CACHE_TTL_MS = 60_000;

function invalidate(organizationId) {
  definitionCache.delete(String(organizationId || tenant.getOrganizationId()));
}

async function activeDefinitions() {
  const orgId = String(tenant.requireOrganizationId());
  const hit = definitionCache.get(orgId);
  if (hit && hit.expiresAt > Date.now()) return hit.definitions;

  const definitions = await CustomField.find({ isActive: true }).sort({ order: 1 }).lean();
  definitionCache.set(orgId, { definitions, expiresAt: Date.now() + CACHE_TTL_MS });
  return definitions;
}

async function list(query = {}) {
  const filter = {};
  if (query.section) filter.section = query.section;
  if (query.isActive !== undefined) filter.isActive = query.isActive !== "false";
  return CustomField.find(filter).sort({ section: 1, order: 1 }).lean();
}

async function create(data, req) {
  const existing = await CustomField.findOne({ key: data.key });
  if (existing) throw AppError.conflict(`A field with the key '${data.key}' already exists.`);

  if (["dropdown", "multiselect"].includes(data.type) && !(data.options || []).length) {
    throw AppError.validation([
      { field: "options", message: "Add at least one option for this field type" },
    ]);
  }

  const field = await CustomField.create({ ...data, createdBy: tenant.getUserId() });
  invalidate();

  await audit.record(
    {
      action: "employee.custom_field_created",
      entityType: "EmployeeCustomField",
      entityId: field._id,
      entityLabel: field.label,
      after: field.toObject(),
      severity: "notice",
    },
    req
  );
  return field;
}

async function update(id, data, req) {
  const field = await CustomField.findById(id);
  if (!field) throw AppError.notFound("Custom field");

  const before = field.toObject();

  // The key is the map key on thousands of employee documents. Renaming it
  // would orphan every stored value, so it is immutable after creation.
  if (data.key && data.key !== field.key) {
    throw AppError.badRequest(
      "A field's key cannot be changed once it exists. Create a new field instead."
    );
  }

  Object.assign(field, data, { updatedBy: tenant.getUserId() });
  await field.save();
  invalidate();

  await audit.record(
    {
      action: "employee.custom_field_updated",
      entityType: "EmployeeCustomField",
      entityId: field._id,
      entityLabel: field.label,
      before,
      after: field.toObject(),
      severity: "notice",
      skipIfUnchanged: true,
    },
    req
  );
  return field;
}

/**
 * Deactivate rather than delete. Values stay on the employee records, so
 * switching a field back on restores the history instead of losing it.
 */
async function deactivate(id, req) {
  const field = await CustomField.findById(id);
  if (!field) throw AppError.notFound("Custom field");

  field.isActive = false;
  await field.save();
  invalidate();

  await audit.record(
    {
      action: "employee.custom_field_deactivated",
      entityType: "EmployeeCustomField",
      entityId: field._id,
      entityLabel: field.label,
      severity: "warning",
      description: "Field hidden; existing values were retained",
    },
    req
  );
  return { id: String(field._id), isActive: false };
}

/**
 * Validate and coerce a bag of custom values.
 *
 * @param {object} values         raw input, keyed by field key
 * @param {object} [options]
 * @param {boolean} [options.partial]  skip required checks (PATCH)
 * @param {string} [options.employeeId] excluded from uniqueness checks
 */
async function validateValues(values = {}, options = {}) {
  const definitions = await activeDefinitions();
  const byKey = Object.fromEntries(definitions.map((d) => [d.key, d]));
  const issues = [];
  const out = {};

  // Unknown keys are dropped rather than stored: otherwise a typo in an import
  // silently creates a field nobody can see or edit.
  for (const [key, raw] of Object.entries(values)) {
    const definition = byKey[key];
    if (!definition) continue;

    const value = coerce(definition, raw, issues);
    if (value !== undefined) out[key] = value;
  }

  if (!options.partial) {
    for (const definition of definitions) {
      if (!definition.required) continue;
      const value = out[definition.key];
      if (value === undefined || value === null || value === "") {
        issues.push({ field: `customFields.${definition.key}`, message: `${definition.label} is required` });
      }
    }
  }

  // Uniqueness has to be checked against the collection, one query per field.
  for (const definition of definitions) {
    if (!definition.unique) continue;
    const value = out[definition.key];
    if (value === undefined || value === null || value === "") continue;

    const clash = await Employee.findOne({
      [`customFields.${definition.key}`]: value,
      ...(options.employeeId ? { _id: { $ne: options.employeeId } } : {}),
    })
      .select("employeeCode")
      .lean();

    if (clash) {
      issues.push({
        field: `customFields.${definition.key}`,
        message: `${definition.label} must be unique — ${clash.employeeCode} already has this value`,
      });
    }
  }

  if (issues.length) throw AppError.validation(issues);
  return out;
}

function coerce(definition, raw, issues) {
  const field = `customFields.${definition.key}`;
  const v = definition.validation || {};

  if (raw === null || raw === undefined || raw === "") return null;

  switch (definition.type) {
    case "number":
    case "currency": {
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        issues.push({ field, message: `${definition.label} must be a number` });
        return undefined;
      }
      if (v.min !== null && v.min !== undefined && n < v.min) {
        issues.push({ field, message: `${definition.label} must be at least ${v.min}` });
      }
      if (v.max !== null && v.max !== undefined && n > v.max) {
        issues.push({ field, message: `${definition.label} must be at most ${v.max}` });
      }
      return n;
    }

    case "boolean":
      return raw === true || raw === "true" || raw === 1 || raw === "1" || raw === "yes";

    case "date": {
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) {
        issues.push({ field, message: `${definition.label} must be a valid date` });
        return undefined;
      }
      return d;
    }

    case "email": {
      const s = String(raw).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
        issues.push({ field, message: `${definition.label} must be a valid email address` });
        return undefined;
      }
      return s;
    }

    case "phone": {
      const s = String(raw).trim();
      if (!/^[+0-9][0-9\s\-()]{5,19}$/.test(s)) {
        issues.push({ field, message: `${definition.label} must be a valid phone number` });
        return undefined;
      }
      return s;
    }

    case "dropdown": {
      const allowed = (definition.options || []).map((o) => String(o.value));
      const s = String(raw);
      if (!allowed.includes(s)) {
        issues.push({
          field,
          message: `${definition.label} must be one of: ${allowed.join(", ")}`,
        });
        return undefined;
      }
      return s;
    }

    case "multiselect": {
      const allowed = (definition.options || []).map((o) => String(o.value));
      const arr = (Array.isArray(raw) ? raw : String(raw).split(",")).map((x) => String(x).trim());
      const bad = arr.filter((x) => !allowed.includes(x));
      if (bad.length) {
        issues.push({ field, message: `${definition.label} has invalid values: ${bad.join(", ")}` });
        return undefined;
      }
      return arr;
    }

    case "file":
      return String(raw); // a StoredFile id

    case "textarea":
    case "text":
    default: {
      const s = String(raw).trim();
      if (v.minLength && s.length < v.minLength) {
        issues.push({ field, message: `${definition.label} must be at least ${v.minLength} characters` });
      }
      if (v.maxLength && s.length > v.maxLength) {
        issues.push({ field, message: `${definition.label} must be ${v.maxLength} characters or fewer` });
      }
      if (v.pattern) {
        try {
          if (!new RegExp(v.pattern).test(s)) {
            issues.push({ field, message: `${definition.label} has an invalid format` });
          }
        } catch {
          // A tenant saved a broken regex; ignore rather than 500 on every save.
        }
      }
      return s;
    }
  }
}

/** Strip sensitive custom values for callers without the permission. */
async function filterForViewer(customFields, canSeeSensitive) {
  if (canSeeSensitive) return customFields;
  const definitions = await activeDefinitions();
  const sensitive = new Set(definitions.filter((d) => d.isSensitive).map((d) => d.key));
  const out = {};
  const entries =
    customFields instanceof Map ? [...customFields.entries()] : Object.entries(customFields || {});
  for (const [key, value] of entries) {
    out[key] = sensitive.has(key) ? null : value;
  }
  return out;
}

module.exports = {
  list,
  create,
  update,
  deactivate,
  validateValues,
  activeDefinitions,
  filterForViewer,
  invalidate,
  CustomField,
};
