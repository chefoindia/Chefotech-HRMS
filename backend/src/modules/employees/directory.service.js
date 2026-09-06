"use strict";

const Employee = require("./employee.model");
const storage = require("../../core/storage/storage.service");
const { AppError } = require("../../core/errors/AppError");
const { parseListQuery, searchFilter } = require("../../core/http/queryOptions");
const audit = require("../../core/audit/audit.service");
const tenant = require("../../core/tenancy/tenantContext");

/**
 * The employee directory, duplicate detection and bulk actions — the
 * people-list features that are about many employees at once rather than
 * one record.
 */

/** Who works here: name, role, team, how to reach them. Nothing sensitive. */
async function directory(query = {}) {
  const { page, limit, skip, search } = parseListQuery(query, { allowedSort: ["personal.firstName", "employeeCode"], defaultSort: "personal.firstName", maxLimit: 500 });
  const filter = { status: { $in: ["active", "on_leave", "notice_period"] } };
  if (query.departmentId) filter["employment.departmentId"] = query.departmentId;
  if (query.locationId) filter["employment.locationId"] = query.locationId;
  if (query.designationId) filter["employment.designationId"] = query.designationId;
  const search$ = searchFilter(search, ["personal.firstName", "personal.lastName", "personal.displayName", "employeeCode", "personal.workEmail", "skills"]);
  const final = search$ ? { $and: [filter, search$] } : filter;

  const [rows, total] = await Promise.all([
    Employee.find(final)
      .select("employeeCode personal.firstName personal.lastName personal.displayName personal.workEmail personal.phone personal.dateOfBirth employment.departmentId employment.designationId employment.locationId employment.managerId employment.joiningDate avatarFileId skills")
      .populate([
        { path: "employment.departmentId", select: "name" },
        { path: "employment.designationId", select: "name" },
        { path: "employment.locationId", select: "name" },
        { path: "employment.managerId", select: "employeeCode personal.firstName personal.lastName" },
        { path: "avatarFileId" },
      ])
      .sort({ "personal.firstName": 1, "personal.lastName": 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Employee.countDocuments(final),
  ]);

  const items = rows.map((e) => ({
    id: String(e._id),
    employeeCode: e.employeeCode,
    name: e.personal.displayName || [e.personal.firstName, e.personal.lastName].filter(Boolean).join(" "),
    firstName: e.personal.firstName,
    workEmail: e.personal.workEmail || null,
    phone: e.personal.phone || null,
    department: e.employment.departmentId ? e.employment.departmentId.name : null,
    designation: e.employment.designationId ? e.employment.designationId.name : null,
    location: e.employment.locationId ? e.employment.locationId.name : null,
    manager: e.employment.managerId && e.employment.managerId.personal ? { id: String(e.employment.managerId._id), name: [e.employment.managerId.personal.firstName, e.employment.managerId.personal.lastName].filter(Boolean).join(" ") } : null,
    joiningDate: e.employment.joiningDate,
    birthday: e.personal.dateOfBirth ? String(e.personal.dateOfBirth.toISOString ? e.personal.dateOfBirth.toISOString() : e.personal.dateOfBirth).slice(5, 10) : null,
    avatarUrl: e.avatarFileId && e.avatarFileId.mimeType ? storage.publicImageUrl(e.avatarFileId, { width: 96 }) : null,
    skills: e.skills || [],
  }));
  return { items, page, limit, total };
}

/**
 * Likely duplicates: the same work email, personal email or phone on two
 * records, or the same name and date of birth. Imports and re-hires create
 * these; payroll paying someone twice is what finds them otherwise.
 */
async function duplicates() {
  const rows = await Employee.find({}).withDeleted().select("employeeCode status personal.firstName personal.lastName personal.workEmail personal.personalEmail personal.phone personal.dateOfBirth deletedAt").lean();
  const groups = new Map();
  const add = (key, kind, e) => {
    if (!key) return;
    const k = `${kind}:${key}`;
    if (!groups.has(k)) groups.set(k, { kind, key, employees: [] });
    groups.get(k).employees.push(e);
  };
  for (const e of rows) {
    const p = e.personal || {};
    add(p.workEmail && p.workEmail.toLowerCase(), "work email", e);
    add(p.personalEmail && p.personalEmail.toLowerCase(), "personal email", e);
    add(p.phone && p.phone.replace(/\D/g, "").slice(-10), "phone", e);
    if (p.firstName && p.dateOfBirth) add(`${p.firstName}|${p.lastName || ""}|${String(p.dateOfBirth).slice(0, 10)}`.toLowerCase(), "name and date of birth", e);
  }
  return [...groups.values()]
    .filter((g) => g.employees.length > 1)
    .map((g) => ({
      kind: g.kind,
      value: g.kind === "name and date of birth" ? g.key.split("|").slice(0, 2).join(" ") : g.key,
      employees: g.employees.map((e) => ({ id: String(e._id), employeeCode: e.employeeCode, name: [e.personal.firstName, e.personal.lastName].filter(Boolean).join(" "), status: e.deletedAt ? "archived" : e.status })),
    }));
}

/** One change, many people: department, location, manager, shift, tags, status. */
async function bulk({ employeeIds, action, value, reason }, req, auth) {
  const employees = await Employee.find({ _id: { $in: employeeIds } }).select("_id employeeCode status").lean();
  if (!employees.length) throw AppError.badRequest("No matching employees.");
  const employeeService = require("./employee.service");
  const results = { updated: 0, failed: [] };

  for (const e of employees) {
    try {
      switch (action) {
        case "set_department":
          await employeeService.update(String(e._id), { employment: { departmentId: value || null } }, req, auth);
          break;
        case "set_location":
          await employeeService.update(String(e._id), { employment: { locationId: value || null } }, req, auth);
          break;
        case "set_manager":
          if (String(value) === String(e._id)) throw new Error("cannot report to themselves");
          await employeeService.update(String(e._id), { employment: { managerId: value || null } }, req, auth);
          break;
        case "set_shift":
          await employeeService.update(String(e._id), { employment: { shiftId: value || null } }, req, auth);
          break;
        case "set_employment_type":
          await employeeService.update(String(e._id), { employment: { employmentType: value } }, req, auth);
          break;
        case "add_tag":
          await Employee.updateOne({ _id: e._id }, { $addToSet: { tags: String(value) } });
          break;
        case "remove_tag":
          await Employee.updateOne({ _id: e._id }, { $pull: { tags: String(value) } });
          break;
        case "change_status":
          if (e.status !== value) await employeeService.changeStatus(String(e._id), { status: value, reason: reason || "Bulk update" }, req);
          break;
        default:
          throw new Error(`Unknown action ${action}`);
      }
      results.updated += 1;
    } catch (err) {
      results.failed.push({ id: String(e._id), employeeCode: e.employeeCode, error: err.message });
    }
  }

  await audit.record({ action: "employee.bulk_update", entityType: "Employee", entityLabel: `${results.updated} employee(s)`, after: { action, value, updated: results.updated, failed: results.failed.length }, severity: "warning" }, req);
  void tenant;
  return results;
}

module.exports = { directory, duplicates, bulk };
