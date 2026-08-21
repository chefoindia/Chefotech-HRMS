"use strict";

const ExcelJS = require("exceljs");
const Papa = require("papaparse");
const Employee = require("../employees/employee.model");
const Department = require("../departments/department.model");
const Designation = require("../designations/designation.model");
const Location = require("../locations/location.model");
const employeeService = require("../employees/employee.service");
const customFields = require("../employees/customField.service");
const { AppError } = require("../../core/errors/AppError");
const audit = require("../../core/audit/audit.service");
const tenant = require("../../core/tenancy/tenantContext");
const { logger } = require("../../config/logger");

/**
 * Bulk employee import.
 *
 * Three explicit steps — analyse, validate, commit — because a silent partial
 * import is the single worst thing an HRMS can do to a customer's data. The
 * user sees every problem row with its reason before anything is written, and
 * the commit reports exactly what went in and what did not.
 *
 * The commit is not transactional across rows on purpose: a single bad row in
 * a 900-row spreadsheet should not discard the other 899. Instead, each row
 * succeeds or fails independently and the response is a per-row ledger.
 */

const MAX_ROWS = 5000;

/** Importable target fields. Order here is the order in the template. */
const FIELD_CATALOG = [
  { key: "employeeCode", label: "Employee Code", hint: "Leave blank to auto-generate" },
  { key: "biometricId", label: "Biometric / Device ID" },
  { key: "personal.firstName", label: "First Name", required: true },
  { key: "personal.middleName", label: "Middle Name" },
  { key: "personal.lastName", label: "Last Name" },
  { key: "personal.gender", label: "Gender", enum: ["male", "female", "other", "undisclosed"] },
  { key: "personal.dateOfBirth", label: "Date of Birth", type: "date" },
  { key: "personal.workEmail", label: "Work Email", type: "email" },
  { key: "personal.personalEmail", label: "Personal Email", type: "email" },
  { key: "personal.phone", label: "Phone" },
  { key: "personal.bloodGroup", label: "Blood Group" },
  { key: "personal.maritalStatus", label: "Marital Status", enum: ["single", "married", "divorced", "widowed", "undisclosed"] },
  { key: "personal.currentAddress.line1", label: "Address Line 1" },
  { key: "personal.currentAddress.city", label: "City" },
  { key: "personal.currentAddress.state", label: "State" },
  { key: "personal.currentAddress.postalCode", label: "Postal Code" },
  { key: "employment.departmentCode", label: "Department Code", lookup: "department" },
  { key: "employment.designationCode", label: "Designation Code", lookup: "designation" },
  { key: "employment.locationCode", label: "Location Code", lookup: "location" },
  { key: "employment.managerCode", label: "Manager Employee Code", lookup: "manager" },
  { key: "employment.joiningDate", label: "Joining Date", type: "date", required: true },
  { key: "employment.employmentType", label: "Employment Type", enum: ["full_time", "part_time", "contract", "intern", "consultant", "temporary"] },
  { key: "employment.workMode", label: "Work Mode", enum: ["on_site", "remote", "hybrid"] },
  { key: "employment.probationMonths", label: "Probation (months)", type: "number" },
  { key: "bank.accountHolderName", label: "Bank Account Name" },
  { key: "bank.accountNumber", label: "Bank Account Number" },
  { key: "bank.bankName", label: "Bank Name" },
  { key: "bank.ifscCode", label: "IFSC / Sort Code" },
  { key: "statutory.pfNumber", label: "PF Number" },
  { key: "statutory.uan", label: "UAN" },
  { key: "statutory.esiNumber", label: "ESI Number" },
  { key: "statutory.taxId", label: "Tax ID / PAN" },
];

/** Downloadable starter workbook, including any custom fields the tenant added. */
async function buildTemplate() {
  const custom = await customFields.activeDefinitions();
  const columns = [
    ...FIELD_CATALOG,
    ...custom.map((c) => ({ key: `customFields.${c.key}`, label: c.label, required: c.required })),
  ];

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Chefotech HRMS";
  const sheet = workbook.addWorksheet("Employees");

  sheet.columns = columns.map((c) => ({
    header: c.required ? `${c.label} *` : c.label,
    key: c.key,
    width: Math.max(16, c.label.length + 4),
  }));

  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFEEF2FF" },
  };
  sheet.getRow(1).alignment = { vertical: "middle" };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  // A worked example so the expected formats are unambiguous.
  sheet.addRow({
    employeeCode: "",
    "personal.firstName": "Ravi",
    "personal.lastName": "Kumar",
    "personal.gender": "male",
    "personal.dateOfBirth": "1995-04-12",
    "personal.workEmail": "ravi.kumar@example.com",
    "personal.phone": "+919812345678",
    "employment.departmentCode": "OPS",
    "employment.designationCode": "EXEC",
    "employment.locationCode": "HO",
    "employment.joiningDate": "2026-01-15",
    "employment.employmentType": "full_time",
  });

  const notes = workbook.addWorksheet("How to use");
  notes.columns = [
    { header: "Column", key: "column", width: 30 },
    { header: "Required", key: "required", width: 10 },
    { header: "Accepted values / format", key: "format", width: 60 },
  ];
  notes.getRow(1).font = { bold: true };
  for (const c of columns) {
    notes.addRow({
      column: c.label,
      required: c.required ? "Yes" : "No",
      format: c.enum
        ? c.enum.join(", ")
        : c.type === "date"
          ? "YYYY-MM-DD"
          : c.lookup
            ? `Must match an existing ${c.lookup} code`
            : c.hint || "Free text",
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return { buffer: Buffer.from(buffer), fileName: "chefotech-employee-import-template.xlsx" };
}

/** Parse an uploaded file into headers + rows, and guess the column mapping. */
async function analyse(file) {
  const rows = await parseFile(file);
  if (!rows.length) throw new AppError("IMPORT_FAILED", { message: "That file has no data rows." });
  if (rows.length > MAX_ROWS) {
    throw new AppError("IMPORT_FAILED", {
      message: `Import files are limited to ${MAX_ROWS} rows. Split the file and try again.`,
    });
  }

  const headers = Object.keys(rows[0]);
  const custom = await customFields.activeDefinitions();
  const targets = [
    ...FIELD_CATALOG,
    ...custom.map((c) => ({ key: `customFields.${c.key}`, label: c.label, required: c.required })),
  ];

  const mapping = {};
  for (const header of headers) {
    const match = guessTarget(header, targets);
    if (match) mapping[header] = match.key;
  }

  return {
    totalRows: rows.length,
    headers,
    suggestedMapping: mapping,
    targets: targets.map((t) => ({
      key: t.key,
      label: t.label,
      required: Boolean(t.required),
      enum: t.enum || null,
      type: t.type || "text",
      lookup: t.lookup || null,
    })),
    sample: rows.slice(0, 5),
    rows,
  };
}

function guessTarget(header, targets) {
  const normalise = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const h = normalise(header);
  return (
    targets.find((t) => normalise(t.label) === h) ||
    targets.find((t) => normalise(t.key) === h) ||
    targets.find((t) => normalise(t.label).replace(/\*/g, "") === h) ||
    targets.find((t) => h.includes(normalise(t.label)) && normalise(t.label).length > 4) ||
    null
  );
}

async function parseFile(file) {
  const name = String(file.originalname || "").toLowerCase();

  if (name.endsWith(".csv") || file.mimetype === "text/csv") {
    const text = file.buffer.toString("utf8");
    const result = Papa.parse(text, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
    if (result.errors.length) {
      logger.warn({ errors: result.errors.slice(0, 3) }, "CSV parse warnings");
    }
    return result.data;
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file.buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new AppError("IMPORT_FAILED", { message: "That workbook has no sheets." });

  const headers = [];
  sheet.getRow(1).eachCell((cell, col) => {
    headers[col] = String(cell.value || "").replace(/\s*\*$/, "").trim();
  });

  const rows = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record = {};
    let hasValue = false;
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const key = headers[col];
      if (!key) return;
      const value = readCell(cell);
      record[key] = value;
      if (value !== "" && value !== null && value !== undefined) hasValue = true;
    });
    if (hasValue) rows.push(record);
  });

  return rows;
}

function readCell(cell) {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if (value.text) return String(value.text);
    if (value.result !== undefined) return value.result;
    if (value.richText) return value.richText.map((r) => r.text).join("");
  }
  return value;
}

/** Resolve department/designation/location/manager codes to ids, once. */
async function buildLookups() {
  const [departments, designations, locations, managers] = await Promise.all([
    Department.find({}).select("code name").lean(),
    Designation.find({}).select("code name").lean(),
    Location.find({}).select("code name").lean(),
    Employee.find({}).select("employeeCode").lean(),
  ]);

  const index = (rows, key) =>
    Object.fromEntries(rows.map((r) => [String(r[key] || "").toUpperCase(), r._id]));

  return {
    department: index(departments, "code"),
    designation: index(designations, "code"),
    location: index(locations, "code"),
    manager: index(managers, "employeeCode"),
    departmentNames: departments.map((d) => d.code),
    designationNames: designations.map((d) => d.code),
    locationNames: locations.map((l) => l.code),
  };
}

/**
 * Validate mapped rows without writing anything.
 * @param {{ rows: object[], mapping: Record<string,string> }} payload
 */
async function validateRows({ rows = [], mapping = {} }) {
  if (!rows.length) throw new AppError("IMPORT_FAILED", { message: "There are no rows to validate." });

  const lookups = await buildLookups();
  const custom = await customFields.activeDefinitions();
  const seenCodes = new Set();
  const seenEmails = new Set();

  const results = [];
  for (let i = 0; i < rows.length; i += 1) {
    const rowNumber = i + 2; // +1 for the header, +1 for 1-indexing
    const { record, errors } = await mapRow(rows[i], mapping, lookups, custom);

    // In-file duplicates are as important as database duplicates: a
    // spreadsheet with the same code twice would otherwise half-import.
    if (record.employeeCode) {
      const code = String(record.employeeCode).toUpperCase();
      if (seenCodes.has(code)) {
        errors.push({ field: "employeeCode", message: `Duplicate employee code in this file (${record.employeeCode})` });
      }
      seenCodes.add(code);
      if (lookups.manager[code]) {
        errors.push({ field: "employeeCode", message: `An employee with code ${record.employeeCode} already exists` });
      }
    }

    const email = record.personal && record.personal.workEmail;
    if (email) {
      if (seenEmails.has(email)) {
        errors.push({ field: "personal.workEmail", message: `Duplicate work email in this file (${email})` });
      }
      seenEmails.add(email);
      const clash = await Employee.findOne({ "personal.workEmail": email }).select("employeeCode").lean();
      if (clash) {
        errors.push({
          field: "personal.workEmail",
          message: `${email} is already used by ${clash.employeeCode}`,
        });
      }
    }

    results.push({ rowNumber, record, errors, valid: errors.length === 0 });
  }

  const invalid = results.filter((r) => !r.valid);
  return {
    total: results.length,
    validCount: results.length - invalid.length,
    invalidCount: invalid.length,
    rows: results,
    errorReport: invalid.map((r) => ({
      rowNumber: r.rowNumber,
      employeeCode: r.record.employeeCode || "",
      name: [r.record.personal && r.record.personal.firstName, r.record.personal && r.record.personal.lastName]
        .filter(Boolean)
        .join(" "),
      errors: r.errors,
    })),
  };
}

async function mapRow(raw, mapping, lookups, customDefinitions) {
  const record = {};
  const errors = [];
  const customValues = {};

  for (const [header, target] of Object.entries(mapping)) {
    if (!target) continue;
    const value = raw[header];
    if (value === "" || value === null || value === undefined) continue;

    if (target.startsWith("customFields.")) {
      customValues[target.slice("customFields.".length)] = value;
      continue;
    }

    const definition = FIELD_CATALOG.find((f) => f.key === target);

    // Code columns become ids.
    if (definition && definition.lookup) {
      const code = String(value).trim().toUpperCase();
      const id = lookups[definition.lookup][code];
      if (!id) {
        errors.push({
          field: target,
          message: `No ${definition.lookup} found with code "${value}"`,
        });
        continue;
      }
      const targetKey = target.replace(/Code$/, "Id");
      setPath(record, targetKey, id);
      continue;
    }

    if (definition && definition.type === "date") {
      const parsed = parseDate(value);
      if (!parsed) {
        errors.push({ field: target, message: `"${value}" is not a valid date (use YYYY-MM-DD)` });
        continue;
      }
      setPath(record, target, parsed);
      continue;
    }

    if (definition && definition.type === "number") {
      const n = Number(value);
      if (!Number.isFinite(n)) {
        errors.push({ field: target, message: `"${value}" is not a number` });
        continue;
      }
      setPath(record, target, n);
      continue;
    }

    if (definition && definition.enum) {
      const normalised = String(value).trim().toLowerCase().replace(/[\s-]+/g, "_");
      if (!definition.enum.includes(normalised)) {
        errors.push({
          field: target,
          message: `"${value}" is not valid. Use one of: ${definition.enum.join(", ")}`,
        });
        continue;
      }
      setPath(record, target, normalised);
      continue;
    }

    if (definition && definition.type === "email") {
      const email = String(value).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errors.push({ field: target, message: `"${value}" is not a valid email address` });
        continue;
      }
      setPath(record, target, email);
      continue;
    }

    setPath(record, target, typeof value === "string" ? value.trim() : value);
  }

  // Required fields
  for (const field of FIELD_CATALOG.filter((f) => f.required)) {
    if (getPath(record, field.key) === undefined) {
      errors.push({ field: field.key, message: `${field.label} is required` });
    }
  }

  if (Object.keys(customValues).length || customDefinitions.some((c) => c.required)) {
    try {
      record.customFields = await customFields.validateValues(customValues, { partial: false });
    } catch (err) {
      if (err.details) errors.push(...err.details);
      else errors.push({ field: "customFields", message: err.message });
    }
  }

  return { record, errors };
}

function parseDate(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  // DD/MM/YYYY and DD-MM-YYYY, the formats Indian HR spreadsheets actually use.
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (dmy) {
    const [, d, m, y] = dmy;
    const iso = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    return Number.isNaN(Date.parse(iso)) ? null : iso;
  }

  const parsed = Date.parse(s);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
}

/** Write the valid rows. Invalid rows are returned, never silently skipped. */
async function commit({ rows = [], mapping = {}, skipInvalid = true }, req) {
  const validation = await validateRows({ rows, mapping });

  if (!skipInvalid && validation.invalidCount > 0) {
    throw new AppError("IMPORT_FAILED", {
      message: `${validation.invalidCount} of ${validation.total} rows have errors. Fix them or choose to import only the valid rows.`,
      details: validation.errorReport.slice(0, 50),
    });
  }

  const imported = [];
  const failed = [...validation.errorReport];

  for (const row of validation.rows) {
    if (!row.valid) continue;
    try {
      const employee = await employeeService.create(
        { ...row.record, status: "active" },
        req
      );
      imported.push({
        rowNumber: row.rowNumber,
        id: String(employee._id),
        employeeCode: employee.employeeCode,
        name: employee.fullName,
      });
    } catch (err) {
      failed.push({
        rowNumber: row.rowNumber,
        employeeCode: row.record.employeeCode || "",
        name: [row.record.personal && row.record.personal.firstName].filter(Boolean).join(" "),
        errors: [{ field: "_row", message: err.message }],
      });
      logger.warn({ err, rowNumber: row.rowNumber }, "Import row failed at write time");
    }
  }

  await audit.record(
    {
      action: "employee.imported",
      entityType: "Employee",
      entityLabel: `${imported.length} employees`,
      after: { imported: imported.length, failed: failed.length, total: validation.total },
      severity: "warning",
      description: `Bulk import: ${imported.length} created, ${failed.length} rejected`,
    },
    req
  );

  return {
    total: validation.total,
    importedCount: imported.length,
    failedCount: failed.length,
    imported,
    failed,
  };
}

function setPath(obj, path, value) {
  const parts = path.split(".");
  let cursor = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (!cursor[parts[i]]) cursor[parts[i]] = {};
    cursor = cursor[parts[i]];
  }
  cursor[parts[parts.length - 1]] = value;
}

function getPath(obj, path) {
  return path.split(".").reduce((acc, key) => (acc === undefined || acc === null ? undefined : acc[key]), obj);
}

module.exports = { buildTemplate, analyse, validateRows, commit, FIELD_CATALOG };
