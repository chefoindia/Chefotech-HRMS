"use strict";

const { Exit, DEFAULT_TASKS } = require("./exit.model");
const Employee = require("../employees/employee.model");
const employeeService = require("../employees/employee.service");
const notifications = require("../notifications/notification.service");
const recipients = require("../notifications/recipients");
const inputs = require("../payroll/inputs.service");
const settings = require("../../core/settings/settings.service");
const { AppError } = require("../../core/errors/AppError");
const { parseListQuery } = require("../../core/http/queryOptions");
const audit = require("../../core/audit/audit.service");
const tenant = require("../../core/tenancy/tenantContext");
const { logger } = require("../../config/logger");
const dt = require("../../shared/datetime");

/** Exits and offboarding. See exit.model.js. */

const POPULATE = [
  { path: "employeeId", select: "employeeCode personal.firstName personal.lastName personal.workEmail employment.departmentId employment.designationId employment.managerId employment.noticePeriodDays employment.joiningDate userId", populate: [{ path: "employment.departmentId", select: "name" }, { path: "employment.designationId", select: "name" }] },
  { path: "decidedBy", select: "firstName lastName" },
  { path: "tasks.assigneeUserId", select: "firstName lastName" },
  { path: "tasks.completedBy", select: "firstName lastName" },
];

async function noticeDaysFor(employee) {
  if (employee.employment && employee.employment.noticePeriodDays) return employee.employment.noticePeriodDays;
  return Number(await settings.get("employee.notice_period_days").catch(() => 30)) || 30;
}

/** The employee resigns. */
async function resign(employeeId, { proposedLastDay, reason }, req) {
  const employee = await Employee.findById(employeeId).lean();
  if (!employee) throw new AppError("EMPLOYEE_NOT_FOUND");
  const open = await Exit.findOne({ employeeId, status: { $in: ["requested", "accepted", "in_progress"] } }).lean();
  if (open) throw AppError.conflict("An exit is already in progress for you.");

  const today = dt.todayString();
  const noticeDays = await noticeDaysFor(employee);
  const earliest = dt.addDays(today, noticeDays);
  const lastDay = proposedLastDay || earliest;
  const shortfall = Math.max(0, dt.daysBetween(today, earliest) - dt.daysBetween(today, lastDay));

  const exit = await Exit.create({
    employeeId,
    type: "resignation",
    reason: reason || "",
    proposedLastDay: lastDay,
    resignationDate: today,
    noticePeriodDays: noticeDays,
    noticeShortfallDays: shortfall,
    initiatedBy: "employee",
    createdBy: tenant.getUserId(),
  });

  await audit.record({ action: "exit.resignation_submitted", entityType: "EmployeeExit", entityId: exit._id, entityLabel: employee.employeeCode, after: { proposedLastDay: lastDay, shortfall }, severity: "warning" }, req);

  const hr = await recipients.usersWithPermission("exit.manage");
  const manager = await recipients.managerOf(employee);
  const audience = [...hr, ...(manager ? [manager] : [])];
  notifications
    .notify({
      template: "resignation_submitted",
      recipients: audience,
      organization: await recipients.organization(),
      data: { employee: { id: String(employee._id), name: fullName(employee) }, resignation: { proposedLastDay: lastDay, reason: reason || "—" }, actor: { userId: employee.userId } },
      severity: "warning",
      entity: { type: "EmployeeExit", id: exit._id },
    })
    .catch((err) => logger.warn({ err }, "Resignation notification failed"));

  return shape(await Exit.findById(exit._id).populate(POPULATE).lean());
}

/** HR starts an exit: a termination, a contract ending, a retirement — or a resignation received on paper. */
async function initiate({ employeeId, type, lastWorkingDay, reason, noticeWaived, isRehirable }, req) {
  const employee = await Employee.findById(employeeId).lean();
  if (!employee) throw new AppError("EMPLOYEE_NOT_FOUND");
  const open = await Exit.findOne({ employeeId, status: { $in: ["requested", "accepted", "in_progress"] } }).lean();
  if (open) throw AppError.conflict("An exit is already in progress for this employee.");

  const exit = await Exit.create({
    employeeId,
    type,
    reason: reason || "",
    proposedLastDay: lastWorkingDay,
    lastWorkingDay,
    resignationDate: type === "resignation" ? dt.todayString() : null,
    noticePeriodDays: await noticeDaysFor(employee),
    noticeWaived: Boolean(noticeWaived),
    isRehirable: isRehirable !== false,
    status: "accepted",
    initiatedBy: "hr",
    decidedBy: tenant.getUserId(),
    decidedAt: new Date(),
    createdBy: tenant.getUserId(),
  });
  await accept(exit, employee, { lastWorkingDay, comment: "" }, req);
  return shape(await Exit.findById(exit._id).populate(POPULATE).lean());
}

/** HR accepts or refuses a resignation. Accepting fixes the last day and starts clearance. */
async function decide(id, { decision, lastWorkingDay, comment, noticeWaived }, req) {
  const exit = await Exit.findById(id);
  if (!exit) throw AppError.notFound("Exit");
  if (exit.status !== "requested") throw new AppError("WORKFLOW_INVALID_STATE", { message: `This resignation has already been ${exit.status}.` });
  const employee = await Employee.findById(exit.employeeId).lean();

  exit.decidedBy = tenant.getUserId();
  exit.decidedAt = new Date();
  exit.decisionComment = comment || "";
  if (decision !== "approve") {
    exit.status = "rejected";
    await exit.save();
    await notifyEmployee(employee, "resignation_decided", { resignation: { status: "declined", note: comment ? ` ${comment}` : "" } }, exit);
    await audit.record({ action: "exit.resignation_rejected", entityType: "EmployeeExit", entityId: exit._id, entityLabel: employee.employeeCode, after: { comment }, severity: "notice" }, req);
    return shape(await Exit.findById(exit._id).populate(POPULATE).lean());
  }

  exit.status = "accepted";
  exit.noticeWaived = Boolean(noticeWaived);
  await exit.save();
  await accept(exit, employee, { lastWorkingDay: lastWorkingDay || exit.proposedLastDay, comment }, req);
  return shape(await Exit.findById(exit._id).populate(POPULATE).lean());
}

/** Shared by decide() and initiate(): set the dates, move the employee to notice, build the checklist, tell people. */
async function accept(exit, employee, { lastWorkingDay, comment }, req) {
  exit.lastWorkingDay = lastWorkingDay;
  if (exit.resignationDate && !exit.noticeWaived) {
    const served = dt.daysBetween(exit.resignationDate, lastWorkingDay);
    exit.noticeShortfallDays = Math.max(0, (exit.noticePeriodDays || 0) - served);
  } else {
    exit.noticeShortfallDays = 0;
  }

  const custom = await settings.get("exit.clearance_tasks").catch(() => null);
  const template = Array.isArray(custom) && custom.length ? custom : DEFAULT_TASKS;
  const manager = await recipients.managerOf(employee);
  const owners = {
    hr: await recipients.usersWithPermission("exit.manage"),
    it: await recipients.usersWithPermission("asset.manage"),
    finance: await recipients.usersWithPermission("payroll.process"),
    admin: await recipients.usersWithPermission("asset.manage"),
    manager: manager && manager.userId ? [manager] : [],
    employee: employee.userId ? [recipients.employeeToRecipient(employee)] : [],
  };
  exit.tasks = template.map((t) => {
    const owner = typeof t === "string" ? "hr" : t.owner || "hr";
    const first = (owners[owner] || owners.hr)[0];
    return { title: typeof t === "string" ? t : t.title, description: (t && t.description) || "", owner, assigneeUserId: first ? first.userId : null };
  });
  exit.status = "in_progress";
  await exit.save();

  // The employee record follows: notice period now, resigned on the last day.
  const current = await Employee.findById(employee._id).select("status").lean();
  if (current && ["active", "on_leave"].includes(current.status)) {
    await employeeService.changeStatus(
      String(employee._id),
      { status: "notice_period", effectiveFrom: new Date(), reason: `${exit.type} — last working day ${lastWorkingDay}`, exit: { resignationDate: exit.resignationDate ? new Date(exit.resignationDate) : null, lastWorkingDay: new Date(lastWorkingDay), exitType: exit.type, reason: exit.reason, isRehirable: exit.isRehirable } },
      req
    ).catch((err) => logger.warn({ err }, "Could not move the employee to notice period"));
  }

  const organization = await recipients.organization();
  if (exit.initiatedBy === "employee") {
    await notifyEmployee(employee, "resignation_decided", { resignation: { status: "accepted", note: ` Your last working day is ${lastWorkingDay}.${comment ? ` ${comment}` : ""}` } }, exit);
  }
  const departmentName = employee.employment && employee.employment.departmentId && employee.employment.departmentId.name;
  const designationName = employee.employment && employee.employment.designationId && employee.employment.designationId.name;
  const audience = dedupe([...owners.hr, ...owners.it, ...owners.finance, ...owners.manager]);
  notifications
    .notify({
      template: "exit_initiated",
      recipients: audience,
      organization,
      data: { employee: { id: String(employee._id), name: fullName(employee), designation: designationName || "", department: departmentName || "" }, exit: { type: exit.type.replace(/_/g, " "), lastWorkingDay } },
      severity: "warning",
      entity: { type: "EmployeeExit", id: exit._id },
    })
    .catch(() => {});
  for (const task of exit.tasks) {
    if (!task.assigneeUserId) continue;
    const who = audience.find((a) => String(a.userId) === String(task.assigneeUserId)) || owners.employee.find((a) => String(a.userId) === String(task.assigneeUserId));
    if (!who) continue;
    notifications
      .notify({ template: "exit_task_assigned", recipients: [who], organization, data: { task: { title: task.title }, employee: { id: String(employee._id), name: fullName(employee) }, exit: { lastWorkingDay } }, entity: { type: "EmployeeExit", id: exit._id } })
      .catch(() => {});
  }

  await audit.record({ action: "exit.accepted", entityType: "EmployeeExit", entityId: exit._id, entityLabel: employee.employeeCode, after: { type: exit.type, lastWorkingDay, tasks: exit.tasks.length, shortfall: exit.noticeShortfallDays }, severity: "warning" }, req);
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((r) => r && r.userId && !seen.has(String(r.userId)) && seen.add(String(r.userId)));
}

async function notifyEmployee(employee, template, data, exit) {
  if (!employee) return;
  await notifications
    .notify({ template, recipients: [recipients.employeeToRecipient(employee)], organization: await recipients.organization(), data: { employee: { firstName: employee.personal.firstName }, ...data }, entity: { type: "EmployeeExit", id: exit._id } })
    .catch(() => {});
}

async function update(id, data, req) {
  const exit = await Exit.findById(id);
  if (!exit) throw AppError.notFound("Exit");
  if (["completed", "rejected", "withdrawn", "cancelled"].includes(exit.status)) throw AppError.conflict("This exit is closed.");
  const before = { lastWorkingDay: exit.lastWorkingDay, noticeWaived: exit.noticeWaived, isRehirable: exit.isRehirable };
  for (const key of ["lastWorkingDay", "noticeWaived", "isRehirable", "exitInterviewNotes", "reason"]) if (data[key] !== undefined) exit[key] = data[key];
  if (data.lastWorkingDay && exit.resignationDate && !exit.noticeWaived) {
    exit.noticeShortfallDays = Math.max(0, (exit.noticePeriodDays || 0) - dt.daysBetween(exit.resignationDate, data.lastWorkingDay));
  }
  if (exit.noticeWaived) exit.noticeShortfallDays = 0;
  await exit.save();
  if (data.lastWorkingDay) {
    await Employee.updateOne({ _id: exit.employeeId }, { $set: { "exit.lastWorkingDay": new Date(data.lastWorkingDay), "exit.isRehirable": exit.isRehirable } });
  }
  await audit.record({ action: "exit.updated", entityType: "EmployeeExit", entityId: exit._id, before, after: { lastWorkingDay: exit.lastWorkingDay, noticeWaived: exit.noticeWaived, isRehirable: exit.isRehirable }, skipIfUnchanged: true }, req);
  return shape(await Exit.findById(exit._id).populate(POPULATE).lean());
}

async function completeTask(id, taskId, { status, note, recoveryAmount }, auth, req) {
  const exit = await Exit.findById(id);
  if (!exit) throw AppError.notFound("Exit");
  const task = exit.tasks.id(taskId);
  if (!task) throw AppError.notFound("Task");
  const canManage = (auth.permissions || []).includes("exit.manage");
  const isAssignee = task.assigneeUserId && String(task.assigneeUserId) === String(auth.userId);
  const isOwnExit = auth.employeeId && String(exit.employeeId) === String(auth.employeeId) && task.owner === "employee";
  if (!canManage && !isAssignee && !isOwnExit) throw AppError.forbidden("This task is not assigned to you.");

  task.status = status || "done";
  task.completedAt = new Date();
  task.completedBy = auth.userId;
  task.note = note || "";
  if (recoveryAmount !== undefined && canManage) task.recoveryAmount = recoveryAmount || 0;
  await exit.save();
  await audit.record({ action: "exit.task_completed", entityType: "EmployeeExit", entityId: exit._id, entityLabel: task.title, after: { status: task.status, note, recoveryAmount: task.recoveryAmount }, severity: "info" }, req);
  return shape(await Exit.findById(exit._id).populate(POPULATE).lean());
}

async function addTask(id, { title, owner, description }, req) {
  const exit = await Exit.findById(id);
  if (!exit) throw AppError.notFound("Exit");
  exit.tasks.push({ title, owner: owner || "hr", description: description || "" });
  await exit.save();
  await audit.record({ action: "exit.task_added", entityType: "EmployeeExit", entityId: exit._id, entityLabel: title, severity: "info" }, req);
  return shape(await Exit.findById(exit._id).populate(POPULATE).lean());
}

/** Compute (or recompute) the settlement from salary, leave, loans and the clearance recoveries. */
async function computeSettlement(id, req) {
  const exit = await Exit.findById(id);
  if (!exit) throw AppError.notFound("Exit");
  if (!exit.lastWorkingDay) throw AppError.badRequest("Set the last working day first.");
  const employee = await Employee.findById(exit.employeeId).lean();
  const documents = require("../documents/document.service");
  const Organization = require("../organizations/organization.model");
  const organization = await tenant.runAsSystem(() => Organization.findById(tenant.requireOrganizationId()).lean(), "exit.settlement");
  const payroll = require("../payroll/payroll.service");
  const salary = await payroll.salaryFor(employee._id, exit.lastWorkingDay);
  const salaryContext = salary ? { ctcMonthly: salary.ctcMonthly } : null;
  const snapshot = { ...employee, exit: { ...(employee.exit || {}), lastWorkingDay: new Date(exit.lastWorkingDay), resignationDate: exit.resignationDate ? new Date(exit.resignationDate) : null }, employment: { ...employee.employment, noticePeriodDays: exit.noticeWaived ? 0 : exit.noticePeriodDays } };
  const computed = await documents.settlementFor(snapshot, salaryContext, organization, dt.todayString());

  const recoveries = [...computed.recoveries];
  for (const task of exit.tasks) if (task.recoveryAmount > 0) recoveries.push({ label: task.title, detail: task.note || "clearance", amount: task.recoveryAmount });
  const totalRecoveries = Math.round(recoveries.reduce((s, r) => s + r.amount, 0) * 100) / 100;

  exit.settlement.computedAt = new Date();
  exit.settlement.dues = computed.dues;
  exit.settlement.recoveries = recoveries;
  exit.settlement.totalDues = computed.totalDues;
  exit.settlement.totalRecoveries = totalRecoveries;
  exit.settlement.net = Math.round((computed.totalDues - totalRecoveries) * 100) / 100;
  await exit.save();
  await audit.record({ action: "exit.settlement_computed", entityType: "EmployeeExit", entityId: exit._id, after: { totalDues: exit.settlement.totalDues, totalRecoveries, net: exit.settlement.net }, severity: "notice" }, req);
  return shape(await Exit.findById(exit._id).populate(POPULATE).lean());
}

/** HR may adjust lines by hand before settling. */
async function updateSettlement(id, { dues, recoveries }, req) {
  const exit = await Exit.findById(id);
  if (!exit) throw AppError.notFound("Exit");
  if (exit.settlement.settledAt) throw AppError.conflict("The settlement has already been filed with payroll.");
  if (dues) exit.settlement.dues = dues;
  if (recoveries) exit.settlement.recoveries = recoveries;
  exit.settlement.totalDues = Math.round(exit.settlement.dues.reduce((s, d) => s + (d.amount || 0), 0) * 100) / 100;
  exit.settlement.totalRecoveries = Math.round(exit.settlement.recoveries.reduce((s, d) => s + (d.amount || 0), 0) * 100) / 100;
  exit.settlement.net = Math.round((exit.settlement.totalDues - exit.settlement.totalRecoveries) * 100) / 100;
  exit.settlement.computedAt = exit.settlement.computedAt || new Date();
  await exit.save();
  await audit.record({ action: "exit.settlement_edited", entityType: "EmployeeExit", entityId: exit._id, after: { net: exit.settlement.net }, severity: "notice" }, req);
  return shape(await Exit.findById(exit._id).populate(POPULATE).lean());
}

/** File the net settlement with payroll and, optionally, generate the statement. */
async function settle(id, { generateDocument = true } = {}, req) {
  const exit = await Exit.findById(id);
  if (!exit) throw AppError.notFound("Exit");
  if (!exit.settlement.computedAt) throw AppError.badRequest("Compute the settlement first.");
  if (exit.settlement.settledAt) throw AppError.conflict("Already settled.");
  const net = exit.settlement.net;
  if (net !== 0) {
    const input = await inputs.add(
      { employeeId: exit.employeeId, type: net > 0 ? "earning" : "deduction", label: "Full and final settlement", amount: Math.abs(net), reason: `Exit ${exit._id}`, source: { type: "settlement", id: exit._id } },
      req
    );
    exit.settlement.payrollInputId = input._id;
  }
  exit.settlement.settledAt = new Date();
  if (generateDocument) {
    try {
      const documents = require("../documents/document.service");
      const { DocumentTemplate } = require("../documents/document.model");
      const template = await DocumentTemplate.findOne({ code: "FULL_FINAL_SETTLEMENT", isActive: true }).lean();
      if (template) {
        const { document } = await documents.generateAndStore(String(template._id), { employeeId: exit.employeeId, visibleToEmployee: true }, req, { notify: true });
        exit.settlement.documentId = document._id;
      }
    } catch (err) {
      logger.warn({ err }, "Settlement statement could not be generated");
    }
  }
  await exit.save();
  await audit.record({ action: "exit.settled", entityType: "EmployeeExit", entityId: exit._id, after: { net }, severity: "warning" }, req);
  return shape(await Exit.findById(exit._id).populate(POPULATE).lean());
}

/** The last day has come: the employee leaves the organization. */
async function complete(id, { generateLetters = true } = {}, req) {
  const exit = await Exit.findById(id);
  if (!exit) throw AppError.notFound("Exit");
  if (exit.status !== "in_progress") throw new AppError("WORKFLOW_INVALID_STATE", { message: `This exit is ${exit.status}.` });
  const pending = exit.tasks.filter((t) => t.status === "pending");
  if (pending.length) throw AppError.conflict(`${pending.length} clearance task${pending.length === 1 ? " is" : "s are"} still pending: ${pending.map((t) => t.title).join(", ")}.`, { pending: pending.map((t) => t.title) });

  const employee = await Employee.findById(exit.employeeId).lean();
  const finalStatus = exit.type === "termination" || exit.type === "absconded" ? "terminated" : "resigned";
  if (employee.status !== finalStatus) {
    await employeeService.changeStatus(String(employee._id), { status: finalStatus, effectiveFrom: exit.lastWorkingDay ? new Date(exit.lastWorkingDay) : new Date(), reason: `Exit completed (${exit.type})`, exit: { clearanceCompleted: true, exitInterviewNotes: exit.exitInterviewNotes } }, req);
  }

  const letters = [];
  if (generateLetters) {
    const documents = require("../documents/document.service");
    const { DocumentTemplate } = require("../documents/document.model");
    for (const code of ["RELIEVING_LETTER", "EXPERIENCE_CERTIFICATE"]) {
      try {
        const template = await DocumentTemplate.findOne({ code, isActive: true }).lean();
        if (!template) continue;
        const { document } = await documents.generateAndStore(String(template._id), { employeeId: exit.employeeId, visibleToEmployee: true }, req, { notify: true });
        letters.push(String(document._id));
      } catch (err) {
        logger.warn({ err, code }, "Exit letter could not be generated");
      }
    }
  }

  exit.status = "completed";
  exit.completedAt = new Date();
  await exit.save();
  await audit.record({ action: "exit.completed", entityType: "EmployeeExit", entityId: exit._id, entityLabel: employee.employeeCode, after: { finalStatus, letters: letters.length }, severity: "warning" }, req);
  return { ...shape(await Exit.findById(exit._id).populate(POPULATE).lean()), letters };
}

async function withdraw(id, auth, req) {
  const exit = await Exit.findById(id);
  if (!exit) throw AppError.notFound("Exit");
  const own = auth.employeeId && String(exit.employeeId) === String(auth.employeeId);
  const canManage = (auth.permissions || []).includes("exit.manage");
  if (!own && !canManage) throw AppError.forbidden();
  if (!["requested", "accepted", "in_progress"].includes(exit.status)) throw AppError.conflict("This exit is closed.");
  if (own && !canManage && exit.status !== "requested") throw AppError.conflict("Your resignation has been accepted; ask HR to withdraw it.");

  exit.status = own && !canManage ? "withdrawn" : "cancelled";
  await exit.save();
  const employee = await Employee.findById(exit.employeeId).lean();
  if (employee && employee.status === "notice_period") {
    await employeeService.changeStatus(String(employee._id), { status: "active", effectiveFrom: new Date(), reason: "Exit withdrawn", exit: { resignationDate: null, lastWorkingDay: null, exitType: "", reason: "" } }, req).catch(() => {});
  }
  await inputs.cancelBySource("settlement", exit._id, "Exit withdrawn");
  await audit.record({ action: "exit.withdrawn", entityType: "EmployeeExit", entityId: exit._id, entityLabel: employee ? employee.employeeCode : "", severity: "warning" }, req);
  return shape(await Exit.findById(exit._id).populate(POPULATE).lean());
}

async function list(query, auth) {
  const { page, limit, skip } = parseListQuery(query, { allowedSort: ["createdAt", "lastWorkingDay"], maxLimit: 200 });
  const filter = {};
  if (query.status) filter.status = query.status;
  else if (query.includeClosed !== "true") filter.status = { $in: ["requested", "accepted", "in_progress"] };
  if (query.type) filter.type = query.type;
  if (!(auth.permissions || []).includes("exit.view") && !(auth.permissions || []).includes("exit.manage")) {
    // A manager sees exits of their reports and tasks assigned to them.
    filter.$or = [{ "tasks.assigneeUserId": auth.userId }];
  }
  const [items, total] = await Promise.all([Exit.find(filter).populate(POPULATE).sort({ lastWorkingDay: 1, createdAt: -1 }).skip(skip).limit(limit).lean(), Exit.countDocuments(filter)]);
  return { items: items.map(shape), page, limit, total };
}

async function get(id, auth) {
  const exit = await Exit.findById(id).populate(POPULATE).lean();
  if (!exit) throw AppError.notFound("Exit");
  const own = auth.employeeId && String(exit.employeeId._id || exit.employeeId) === String(auth.employeeId);
  const assignee = (exit.tasks || []).some((t) => t.assigneeUserId && String(t.assigneeUserId._id || t.assigneeUserId) === String(auth.userId));
  const canView = (auth.permissions || []).some((p) => p === "exit.view" || p === "exit.manage");
  if (!own && !assignee && !canView) throw AppError.notFound("Exit");
  return shape(exit, { forEmployee: own && !canView });
}

async function mine(auth) {
  if (!auth.employeeId) return null;
  const exit = await Exit.findOne({ employeeId: auth.employeeId, status: { $in: ["requested", "accepted", "in_progress"] } }).populate(POPULATE).lean();
  return exit ? shape(exit, { forEmployee: true }) : null;
}

/** My tasks across every exit (IT clearing laptops, a manager doing handovers). */
async function myTasks(auth) {
  const exits = await Exit.find({ status: "in_progress", "tasks.assigneeUserId": auth.userId }).populate(POPULATE).lean();
  return exits.flatMap((e) => (e.tasks || []).filter((t) => t.assigneeUserId && String(t.assigneeUserId._id || t.assigneeUserId) === String(auth.userId) && t.status === "pending").map((t) => ({ exitId: String(e._id), taskId: String(t._id), title: t.title, owner: t.owner, employee: shapeEmployee(e.employeeId), lastWorkingDay: e.lastWorkingDay })));
}

/** Leavers this month and next, for the dashboard. */
async function upcoming(days = 60) {
  const today = dt.todayString();
  const rows = await Exit.find({ status: "in_progress", lastWorkingDay: { $gte: today, $lte: dt.addDays(today, days) } }).populate(POPULATE).sort({ lastWorkingDay: 1 }).limit(50).lean();
  return rows.map(shape);
}

function fullName(e) {
  return [e.personal && e.personal.firstName, e.personal && e.personal.lastName].filter(Boolean).join(" ");
}

function shapeEmployee(e) {
  if (!e || !e.personal) return { id: String(e) };
  return { id: String(e._id), employeeCode: e.employeeCode, name: fullName(e), department: e.employment && e.employment.departmentId && e.employment.departmentId.name, designation: e.employment && e.employment.designationId && e.employment.designationId.name, joiningDate: e.employment && e.employment.joiningDate };
}

function shape(x, { forEmployee = false } = {}) {
  const name = (u) => (u && u.firstName ? [u.firstName, u.lastName].filter(Boolean).join(" ") : null);
  const tasks = (x.tasks || []).map((t) => ({ id: String(t._id), title: t.title, description: t.description, owner: t.owner, assignee: name(t.assigneeUserId), assigneeUserId: t.assigneeUserId ? String(t.assigneeUserId._id || t.assigneeUserId) : null, status: t.status, completedAt: t.completedAt, completedBy: name(t.completedBy), note: t.note, recoveryAmount: t.recoveryAmount || 0 }));
  const done = tasks.filter((t) => t.status !== "pending").length;
  return {
    id: String(x._id),
    employee: shapeEmployee(x.employeeId),
    type: x.type,
    reason: forEmployee ? x.reason : x.reason,
    proposedLastDay: x.proposedLastDay,
    lastWorkingDay: x.lastWorkingDay,
    resignationDate: x.resignationDate,
    noticePeriodDays: x.noticePeriodDays,
    noticeWaived: x.noticeWaived,
    noticeShortfallDays: x.noticeShortfallDays,
    isRehirable: forEmployee ? undefined : x.isRehirable,
    status: x.status,
    initiatedBy: x.initiatedBy,
    decidedBy: name(x.decidedBy),
    decidedAt: x.decidedAt,
    decisionComment: x.decisionComment,
    tasks: forEmployee ? tasks.filter((t) => t.owner === "employee") : tasks,
    progress: { done, total: tasks.length, percent: tasks.length ? Math.round((done / tasks.length) * 100) : 0 },
    exitInterviewNotes: forEmployee ? undefined : x.exitInterviewNotes,
    settlement: forEmployee && !(x.settlement && x.settlement.settledAt) ? null : x.settlement && x.settlement.computedAt ? { computedAt: x.settlement.computedAt, dues: x.settlement.dues, recoveries: x.settlement.recoveries, totalDues: x.settlement.totalDues, totalRecoveries: x.settlement.totalRecoveries, net: x.settlement.net, settledAt: x.settlement.settledAt, documentId: x.settlement.documentId ? String(x.settlement.documentId) : null } : null,
    completedAt: x.completedAt,
    createdAt: x.createdAt,
  };
}

module.exports = { resign, initiate, decide, update, completeTask, addTask, computeSettlement, updateSettlement, settle, complete, withdraw, list, get, mine, myTasks, upcoming, Exit };
