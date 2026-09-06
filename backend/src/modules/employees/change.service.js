"use strict";

const { EmployeeChange } = require("./change.model");
const Employee = require("./employee.model");
const notifications = require("../notifications/notification.service");
const recipients = require("../notifications/recipients");
const { AppError } = require("../../core/errors/AppError");
const audit = require("../../core/audit/audit.service");
const tenant = require("../../core/tenancy/tenantContext");
const { logger } = require("../../config/logger");
const dt = require("../../shared/datetime");

/** Employee movements. See change.model.js. */

const LETTER_FOR = { promotion: "PROMOTION_LETTER", transfer: "TRANSFER_LETTER", confirmation: "CONFIRMATION_LETTER", probation_extension: "PROBATION_EXTENSION" };

const POPULATE = [
  { path: "employeeId", select: "employeeCode personal.firstName personal.lastName" },
  { path: "createdBy", select: "firstName lastName" },
];

async function record(employeeId, data, req) {
  const employee = await Employee.findById(employeeId).lean();
  if (!employee) throw new AppError("EMPLOYEE_NOT_FOUND");
  const changes = pickChanges(data);
  if (!Object.keys(changes).length && !["confirmation", "probation_extension"].includes(data.type)) throw AppError.badRequest("Nothing to change.");
  if (data.type === "confirmation") changes.confirmationDate = data.effectiveDate;
  if (data.type === "probation_extension" && !changes.probationMonths) throw AppError.badRequest("Say how many months the probation now runs for.");

  const change = await EmployeeChange.create({
    employeeId,
    type: data.type,
    effectiveDate: data.effectiveDate,
    changes,
    reason: data.reason || "",
    letterTemplateCode: data.generateLetter === false ? null : data.letterTemplateCode || LETTER_FOR[data.type] || null,
    salaryRevision: data.salaryRevision || {},
    createdBy: tenant.getUserId(),
  });

  await audit.record({ action: "employee.change_recorded", entityType: "EmployeeChange", entityId: change._id, entityLabel: `${employee.employeeCode} — ${data.type} from ${data.effectiveDate}`, after: { type: data.type, effectiveDate: data.effectiveDate, changes }, severity: "notice" }, req);

  if (data.effectiveDate <= dt.todayString()) await apply(change._id, req);
  return shape(await EmployeeChange.findById(change._id).populate(POPULATE).lean());
}

function pickChanges(data) {
  const out = {};
  for (const key of ["designationId", "departmentId", "managerId", "locationId", "employmentType", "shiftId", "workMode", "probationMonths", "noticePeriodDays"]) {
    if (data.changes && data.changes[key] !== undefined) out[key] = data.changes[key];
  }
  return out;
}

/** Apply one scheduled change to the employee record. Idempotent by status. */
async function apply(changeId, req) {
  const change = await EmployeeChange.findById(changeId);
  if (!change || change.status !== "scheduled") return change;
  const employeeService = require("./employee.service");
  const employee = await Employee.findById(change.employeeId).lean();
  if (!employee) {
    change.status = "failed";
    change.error = "Employee no longer exists";
    await change.save();
    return change;
  }

  try {
    const previous = {};
    for (const key of Object.keys(change.changes || {})) previous[key] = employee.employment ? employee.employment[key] : undefined;
    change.previous = previous;

    const employmentPatch = { ...change.changes };
    if (change.type === "confirmation") employmentPatch.confirmationDate = change.changes.confirmationDate || change.effectiveDate;
    await employeeService.update(String(employee._id), { employment: employmentPatch }, req, req && req.auth);

    if (change.salaryRevision && change.salaryRevision.ctcAnnual && change.salaryRevision.structureId) {
      const payroll = require("../payroll/payroll.service");
      await payroll.assignSalary(String(employee._id), { structureId: change.salaryRevision.structureId, ctcAnnual: change.salaryRevision.ctcAnnual, componentAmounts: change.salaryRevision.componentAmounts || undefined, effectiveFrom: change.effectiveDate, revisionType: change.type === "promotion" ? "promotion" : "increment", revisionReason: change.reason }, req);
    }

    if (change.letterTemplateCode) {
      try {
        const documents = require("../documents/document.service");
        const { DocumentTemplate } = require("../documents/document.model");
        const template = await DocumentTemplate.findOne({ code: change.letterTemplateCode, isActive: true }).lean();
        if (template) {
          const { document } = await documents.generateAndStore(String(template._id), { employeeId: employee._id, visibleToEmployee: true }, req, { notify: false });
          change.letterDocumentId = document._id;
        }
      } catch (err) {
        logger.warn({ err, changeId: String(change._id) }, "Letter for an employee change could not be generated");
      }
    }

    change.status = "applied";
    change.appliedAt = new Date();
    await change.save();

    await notifyEmployee(change, employee);
    await audit.record({ action: `employee.${change.type}`, entityType: "Employee", entityId: employee._id, entityLabel: employee.employeeCode, before: previous, after: change.changes, severity: "notice" }, req);
  } catch (err) {
    logger.error({ err, changeId: String(change._id) }, "Employee change failed to apply");
    change.status = "failed";
    change.error = err.message;
    await change.save();
  }
  return change;
}

async function notifyEmployee(change, employee) {
  const refreshed = await Employee.findById(employee._id).select("userId personal.firstName personal.lastName personal.workEmail employment.designationId employment.departmentId employment.locationId").populate([{ path: "employment.designationId", select: "name" }, { path: "employment.departmentId", select: "name" }, { path: "employment.locationId", select: "name" }]).lean();
  if (!refreshed) return;
  const template = change.type === "promotion" ? "employee_promoted" : change.type === "confirmation" ? "employee_confirmed" : ["transfer", "department", "location", "manager", "designation", "shift", "employment_type", "work_mode"].includes(change.type) ? "employee_transferred" : null;
  if (!template) return;
  const parts = [];
  if (refreshed.employment.designationId) parts.push(refreshed.employment.designationId.name);
  if (refreshed.employment.departmentId) parts.push(refreshed.employment.departmentId.name);
  if (refreshed.employment.locationId) parts.push(refreshed.employment.locationId.name);
  await notifications
    .notify({
      template,
      recipients: [recipients.employeeToRecipient(refreshed)],
      organization: await recipients.organization(),
      data: { employee: { firstName: refreshed.personal.firstName }, movement: { effectiveFrom: change.effectiveDate, summary: parts.join(", ") || "your new role", toDesignation: refreshed.employment.designationId ? refreshed.employment.designationId.name : "your new role" }, confirmation: { date: change.effectiveDate } },
      severity: "success",
      entity: { type: "EmployeeChange", id: change._id },
    })
    .catch(() => {});
}

/** Daily: apply whatever is due. */
async function applyDue() {
  const due = await EmployeeChange.find({ status: "scheduled", effectiveDate: { $lte: dt.todayString() } }).select("_id").lean();
  let applied = 0;
  for (const row of due) {
    const change = await apply(row._id, null);
    if (change && change.status === "applied") applied += 1;
  }
  return { due: due.length, applied };
}

async function cancel(changeId, req) {
  const change = await EmployeeChange.findById(changeId);
  if (!change) throw AppError.notFound("Change");
  if (change.status !== "scheduled") throw AppError.conflict("Only a scheduled change can be cancelled.");
  change.status = "cancelled";
  await change.save();
  await audit.record({ action: "employee.change_cancelled", entityType: "EmployeeChange", entityId: change._id, severity: "notice" }, req);
  return shape(await EmployeeChange.findById(change._id).populate(POPULATE).lean());
}

async function history(employeeId) {
  const rows = await EmployeeChange.find({ employeeId }).populate(POPULATE).sort({ effectiveDate: -1, createdAt: -1 }).lean();
  return rows.map(shape);
}

/** Everyone whose probation ends within N days and is not yet confirmed. */
async function probationDue(days = 30) {
  const settings = require("../../core/settings/settings.service");
  const defaultMonths = Number(await settings.get("employee.probation_months").catch(() => 3)) || 3;
  const today = dt.todayString();
  const until = dt.addDays(today, days);
  const rows = await Employee.find({ status: { $in: ["active", "on_leave"] }, "employment.confirmationDate": null, "employment.joiningDate": { $ne: null } })
    .select("employeeCode personal.firstName personal.lastName employment.joiningDate employment.probationMonths employment.designationId employment.departmentId")
    .populate([{ path: "employment.designationId", select: "name" }, { path: "employment.departmentId", select: "name" }])
    .lean();
  return rows
    .map((e) => {
      const months = e.employment.probationMonths || defaultMonths;
      const joining = dt.toDateString(e.employment.joiningDate);
      const [y, m, d] = joining.split("-").map(Number);
      const end = new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
      return { id: String(e._id), employeeCode: e.employeeCode, name: [e.personal.firstName, e.personal.lastName].filter(Boolean).join(" "), designation: e.employment.designationId && e.employment.designationId.name, department: e.employment.departmentId && e.employment.departmentId.name, joiningDate: joining, probationEnds: end, isOverdue: end < today };
    })
    .filter((e) => e.probationEnds <= until)
    .sort((a, b) => a.probationEnds.localeCompare(b.probationEnds));
}

function shape(c) {
  const e = c.employeeId && c.employeeId.personal ? c.employeeId : null;
  return {
    id: String(c._id),
    employee: e ? { id: String(e._id), employeeCode: e.employeeCode, name: [e.personal.firstName, e.personal.lastName].filter(Boolean).join(" ") } : { id: String(c.employeeId) },
    type: c.type,
    effectiveDate: c.effectiveDate,
    changes: c.changes,
    previous: c.previous,
    reason: c.reason,
    letterTemplateCode: c.letterTemplateCode,
    letterDocumentId: c.letterDocumentId ? String(c.letterDocumentId) : null,
    salaryRevision: c.salaryRevision && c.salaryRevision.ctcAnnual ? { ctcAnnual: c.salaryRevision.ctcAnnual } : null,
    status: c.status,
    appliedAt: c.appliedAt,
    error: c.error,
    recordedBy: c.createdBy && c.createdBy.firstName ? [c.createdBy.firstName, c.createdBy.lastName].filter(Boolean).join(" ") : null,
    createdAt: c.createdAt,
  };
}

module.exports = { record, apply, applyDue, cancel, history, probationDue, EmployeeChange };
