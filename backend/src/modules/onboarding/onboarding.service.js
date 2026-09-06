"use strict";

const { OnboardingTemplate, Onboarding, DEFAULT_TEMPLATE } = require("./onboarding.model");
const Employee = require("../employees/employee.model");
const notifications = require("../notifications/notification.service");
const recipients = require("../notifications/recipients");
const settings = require("../../core/settings/settings.service");
const { AppError } = require("../../core/errors/AppError");
const { parseListQuery } = require("../../core/http/queryOptions");
const audit = require("../../core/audit/audit.service");
const tenant = require("../../core/tenancy/tenantContext");
const { logger } = require("../../config/logger");
const dt = require("../../shared/datetime");

/** Onboarding. See onboarding.model.js. */

// ── Templates ───────────────────────────────────────────────────────────────

async function listTemplates() {
  return (await OnboardingTemplate.find({}).sort({ isDefault: -1, name: 1 }).lean()).map(shapeTemplate);
}

async function seedDefault() {
  const existing = await OnboardingTemplate.countDocuments({});
  if (existing) return { created: 0 };
  await OnboardingTemplate.create({ ...DEFAULT_TEMPLATE, createdBy: tenant.getUserId() });
  return { created: 1 };
}

async function createTemplate(data, req) {
  if (data.isDefault) await OnboardingTemplate.updateMany({}, { $set: { isDefault: false } });
  const template = await OnboardingTemplate.create({ ...data, createdBy: tenant.getUserId() });
  await audit.record({ action: "onboardingtemplate.created", entityType: "OnboardingTemplate", entityId: template._id, entityLabel: template.name, severity: "notice" }, req);
  return shapeTemplate(template.toObject());
}

async function updateTemplate(id, data, req) {
  const template = await OnboardingTemplate.findById(id);
  if (!template) throw AppError.notFound("Onboarding template");
  if (data.isDefault) await OnboardingTemplate.updateMany({ _id: { $ne: id } }, { $set: { isDefault: false } });
  Object.assign(template, data, { updatedBy: tenant.getUserId() });
  await template.save();
  await audit.record({ action: "onboardingtemplate.updated", entityType: "OnboardingTemplate", entityId: template._id, entityLabel: template.name, severity: "notice" }, req);
  return shapeTemplate(template.toObject());
}

async function deleteTemplate(id, req) {
  const template = await OnboardingTemplate.findById(id);
  if (!template) throw AppError.notFound("Onboarding template");
  await template.softDelete(tenant.getUserId());
  await audit.record({ action: "onboardingtemplate.deleted", entityType: "OnboardingTemplate", entityId: template._id, entityLabel: template.name, severity: "warning" }, req);
  return { id: String(template._id), deleted: true };
}

function shapeTemplate(t) {
  return { id: String(t._id), name: t.name, description: t.description, appliesTo: { departmentIds: (t.appliesTo && t.appliesTo.departmentIds || []).map(String), employmentTypes: (t.appliesTo && t.appliesTo.employmentTypes) || [] }, tasks: (t.tasks || []).map((x) => ({ id: String(x._id), title: x.title, description: x.description, owner: x.owner, dueOffsetDays: x.dueOffsetDays, autoComplete: x.autoComplete || "" })), isDefault: t.isDefault, isActive: t.isActive, createdAt: t.createdAt };
}

/** Which template a joiner gets: the most specific active match, else the default. */
async function templateFor(employee) {
  const templates = await OnboardingTemplate.find({ isActive: true }).lean();
  if (!templates.length) return null;
  const departmentId = String((employee.employment && employee.employment.departmentId) || "");
  const employmentType = (employee.employment && employee.employment.employmentType) || "";
  const specific = templates.find((t) => {
    const a = t.appliesTo || {};
    const dep = a.departmentIds && a.departmentIds.length;
    const typ = a.employmentTypes && a.employmentTypes.length;
    if (!dep && !typ) return false;
    return (!dep || a.departmentIds.map(String).includes(departmentId)) && (!typ || a.employmentTypes.includes(employmentType));
  });
  return specific || templates.find((t) => t.isDefault) || templates[0];
}

// ── Instances ───────────────────────────────────────────────────────────────

const POPULATE = [
  { path: "employeeId", select: "employeeCode personal.firstName personal.lastName personal.workEmail employment.departmentId employment.designationId employment.managerId employment.joiningDate userId status", populate: [{ path: "employment.departmentId", select: "name" }, { path: "employment.designationId", select: "name" }] },
  { path: "buddyEmployeeId", select: "employeeCode personal.firstName personal.lastName" },
  { path: "tasks.assigneeUserId", select: "firstName lastName" },
  { path: "tasks.completedBy", select: "firstName lastName" },
];

async function start({ employeeId, templateId, buddyEmployeeId, welcomeNote }, req, { silent = false } = {}) {
  const employee = await Employee.findById(employeeId).lean();
  if (!employee) throw new AppError("EMPLOYEE_NOT_FOUND");
  const existing = await Onboarding.findOne({ employeeId, status: "in_progress" }).lean();
  if (existing) throw AppError.conflict("Onboarding is already running for this employee.");

  let template = templateId ? await OnboardingTemplate.findById(templateId).lean() : await templateFor(employee);
  if (!template) {
    await seedDefault();
    template = await templateFor(employee);
  }
  if (!template) throw AppError.badRequest("No onboarding checklist is configured.");

  const joining = employee.employment && employee.employment.joiningDate ? dt.toDateString(employee.employment.joiningDate) : dt.todayString();
  const owners = await resolveOwners(employee);

  const onboarding = await Onboarding.create({
    employeeId,
    templateId: template._id,
    templateName: template.name,
    joiningDate: joining,
    buddyEmployeeId: buddyEmployeeId || null,
    welcomeNote: welcomeNote || "",
    tasks: (template.tasks || []).map((t) => {
      const first = (owners[t.owner] || owners.hr)[0];
      return { title: t.title, description: t.description, owner: t.owner, assigneeUserId: first ? first.userId : null, dueOn: dt.addDays(joining, t.dueOffsetDays || 0), autoComplete: t.autoComplete || "" };
    }),
    createdBy: tenant.getUserId(),
  });

  await audit.record({ action: "onboarding.started", entityType: "Onboarding", entityId: onboarding._id, entityLabel: employee.employeeCode, after: { template: template.name, tasks: onboarding.tasks.length }, severity: "notice" }, req);

  if (!silent) {
    const organization = await recipients.organization();
    const told = new Set();
    for (const task of onboarding.tasks) {
      if (!task.assigneeUserId || told.has(String(task.assigneeUserId))) continue;
      told.add(String(task.assigneeUserId));
      const who = Object.values(owners).flat().find((a) => String(a.userId) === String(task.assigneeUserId));
      if (!who) continue;
      const count = onboarding.tasks.filter((t) => String(t.assigneeUserId) === String(task.assigneeUserId)).length;
      notifications
        .notify({ template: "onboarding_task_assigned", recipients: [who], organization, data: { task: { title: count > 1 ? `${task.title} (+${count - 1} more)` : task.title, dueNote: task.dueOn ? ` Due ${task.dueOn}.` : "" }, employee: { id: String(employee._id), name: fullName(employee) } }, entity: { type: "Onboarding", id: onboarding._id } })
        .catch((err) => logger.warn({ err }, "Onboarding notification failed"));
    }
  }
  return shape(await Onboarding.findById(onboarding._id).populate(POPULATE).lean());
}

async function resolveOwners(employee) {
  const manager = await recipients.managerOf(employee);
  return {
    hr: await recipients.usersWithPermission("onboarding.manage"),
    it: await recipients.usersWithPermission("asset.manage"),
    finance: await recipients.usersWithPermission("payroll.assign_salary"),
    admin: await recipients.usersWithPermission("asset.manage"),
    manager: manager && manager.userId ? [manager] : [],
    employee: employee.userId ? [recipients.employeeToRecipient(employee)] : [],
  };
}

/** Called when an employee is created, if the organization wants it. */
async function autoStart(employee, req) {
  const enabled = await settings.get("onboarding.auto_start").catch(() => true);
  if (!enabled) return null;
  try {
    return await start({ employeeId: employee._id }, req);
  } catch (err) {
    logger.warn({ err, employeeId: String(employee._id) }, "Onboarding did not auto-start");
    return null;
  }
}

async function completeTask(id, taskId, { status, note }, auth, req) {
  const onboarding = await Onboarding.findById(id);
  if (!onboarding) throw AppError.notFound("Onboarding");
  const task = onboarding.tasks.id(taskId);
  if (!task) throw AppError.notFound("Task");
  const canManage = (auth.permissions || []).includes("onboarding.manage");
  const isAssignee = task.assigneeUserId && String(task.assigneeUserId) === String(auth.userId);
  const isJoiner = auth.employeeId && String(onboarding.employeeId) === String(auth.employeeId) && task.owner === "employee";
  if (!canManage && !isAssignee && !isJoiner) throw AppError.forbidden("This task is not assigned to you.");
  task.status = status || "done";
  task.completedAt = new Date();
  task.completedBy = auth.userId;
  task.note = note || "";
  await finish(onboarding);
  await audit.record({ action: "onboarding.task_completed", entityType: "Onboarding", entityId: onboarding._id, entityLabel: task.title, after: { status: task.status }, severity: "info" }, req);
  return shape(await Onboarding.findById(onboarding._id).populate(POPULATE).lean());
}

async function finish(onboarding) {
  if (onboarding.tasks.every((t) => t.status !== "pending")) {
    onboarding.status = "completed";
    onboarding.completedAt = new Date();
  }
  await onboarding.save();
}

async function reassignTask(id, taskId, { assigneeUserId }, req) {
  const onboarding = await Onboarding.findById(id);
  if (!onboarding) throw AppError.notFound("Onboarding");
  const task = onboarding.tasks.id(taskId);
  if (!task) throw AppError.notFound("Task");
  task.assigneeUserId = assigneeUserId || null;
  await onboarding.save();
  await audit.record({ action: "onboarding.task_reassigned", entityType: "Onboarding", entityId: onboarding._id, entityLabel: task.title, severity: "info" }, req);
  return shape(await Onboarding.findById(onboarding._id).populate(POPULATE).lean());
}

async function addTask(id, { title, owner, dueOn, description }, req) {
  const onboarding = await Onboarding.findById(id);
  if (!onboarding) throw AppError.notFound("Onboarding");
  const employee = await Employee.findById(onboarding.employeeId).lean();
  const owners = await resolveOwners(employee);
  const first = (owners[owner || "hr"] || owners.hr)[0];
  onboarding.tasks.push({ title, owner: owner || "hr", dueOn: dueOn || null, description: description || "", assigneeUserId: first ? first.userId : null });
  onboarding.status = "in_progress";
  await onboarding.save();
  return shape(await Onboarding.findById(onboarding._id).populate(POPULATE).lean());
}

async function update(id, { buddyEmployeeId, welcomeNote }, req) {
  const onboarding = await Onboarding.findById(id);
  if (!onboarding) throw AppError.notFound("Onboarding");
  if (buddyEmployeeId !== undefined) onboarding.buddyEmployeeId = buddyEmployeeId || null;
  if (welcomeNote !== undefined) onboarding.welcomeNote = welcomeNote;
  await onboarding.save();
  void req;
  return shape(await Onboarding.findById(onboarding._id).populate(POPULATE).lean());
}

async function cancel(id, req) {
  const onboarding = await Onboarding.findById(id);
  if (!onboarding) throw AppError.notFound("Onboarding");
  onboarding.status = "cancelled";
  await onboarding.save();
  await audit.record({ action: "onboarding.cancelled", entityType: "Onboarding", entityId: onboarding._id, severity: "notice" }, req);
  return shape(await Onboarding.findById(onboarding._id).populate(POPULATE).lean());
}

/**
 * Tasks that can tick themselves: the portal invitation sent, documents
 * verified, an asset assigned, policies acknowledged, bank details present.
 * Runs daily and after the relevant events.
 */
async function runAutoCompletions() {
  // $elemMatch, not a dotted $ne: a dotted `$ne: ""` on an array excludes any
  // checklist that has even one manual task alongside the automatic ones.
  const open = await Onboarding.find({ status: "in_progress", tasks: { $elemMatch: { status: "pending", autoComplete: { $nin: ["", null] } } } }).lean();
  let completed = 0;
  for (const row of open) {
    const employee = await Employee.findById(row.employeeId).lean();
    if (!employee) continue;
    const onboarding = await Onboarding.findById(row._id);
    let changed = false;
    for (const task of onboarding.tasks) {
      if (task.status !== "pending" || !task.autoComplete) continue;
      const done = await checkAuto(task.autoComplete, employee);
      if (done) {
        task.status = "done";
        task.completedAt = new Date();
        task.note = "Completed automatically";
        changed = true;
        completed += 1;
      }
    }
    if (changed) await finish(onboarding);
  }
  return { checked: open.length, completed };
}

async function checkAuto(kind, employee) {
  switch (kind) {
    case "portal_invited":
      return Boolean(employee.userId);
    case "bank_details":
      return Boolean(employee.bank && employee.bank.accountNumber);
    case "documents_verified": {
      const { EmployeeDocument } = require("../documents/document.model");
      return (await EmployeeDocument.countDocuments({ employeeId: employee._id, status: "verified", category: "identity" })) > 0;
    }
    case "assets_assigned": {
      const { AssetAssignment } = require("../assets/asset.model");
      return (await AssetAssignment.countDocuments({ employeeId: employee._id, returnedOn: null })) > 0;
    }
    case "policies_acknowledged": {
      if (!employee.userId) return false;
      const { CompanyDocument } = require("../documents/document.model");
      const required = await CompanyDocument.find({ isActive: true, requireAcknowledgement: true }).select("acknowledgements").lean();
      if (!required.length) return false;
      return required.every((d) => (d.acknowledgements || []).some((a) => String(a.userId) === String(employee.userId)));
    }
    default:
      return false;
  }
}

/** Overdue tasks get a reminder every three days. */
async function sendReminders() {
  const today = dt.todayString();
  const threeDaysAgo = new Date(Date.now() - 3 * 86400000);
  const open = await Onboarding.find({ status: "in_progress" }).populate(POPULATE).lean();
  const organization = await recipients.organization();
  let sent = 0;
  for (const row of open) {
    for (const task of row.tasks) {
      if (task.status !== "pending" || !task.dueOn || task.dueOn > today || !task.assigneeUserId) continue;
      if (task.reminderSentAt && new Date(task.reminderSentAt) > threeDaysAgo) continue;
      const User = require("../users/user.model");
      const user = await User.findById(task.assigneeUserId._id || task.assigneeUserId).select("email firstName lastName").lean();
      if (!user) continue;
      await notifications
        .notify({ template: "onboarding_task_assigned", recipients: [recipients.userToRecipient(user)], organization, data: { task: { title: task.title, dueNote: ` It was due on ${task.dueOn}.` }, employee: { id: String(row.employeeId._id || row.employeeId), name: fullName(row.employeeId) } }, severity: "warning", entity: { type: "Onboarding", id: row._id } })
        .catch(() => {});
      await Onboarding.updateOne({ _id: row._id, "tasks._id": task._id }, { $set: { "tasks.$.reminderSentAt": new Date() } });
      sent += 1;
    }
  }
  return { checked: open.length, sent };
}

async function list(query, auth) {
  const { page, limit, skip } = parseListQuery(query, { allowedSort: ["createdAt", "joiningDate"], maxLimit: 200 });
  const filter = {};
  filter.status = query.status || "in_progress";
  if (!(auth.permissions || []).some((p) => p === "onboarding.manage" || p === "employee.view")) filter["tasks.assigneeUserId"] = auth.userId;
  const [items, total] = await Promise.all([Onboarding.find(filter).populate(POPULATE).sort({ joiningDate: -1 }).skip(skip).limit(limit).lean(), Onboarding.countDocuments(filter)]);
  return { items: items.map(shape), page, limit, total };
}

async function get(id, auth) {
  const onboarding = await Onboarding.findById(id).populate(POPULATE).lean();
  if (!onboarding) throw AppError.notFound("Onboarding");
  const own = auth.employeeId && String(onboarding.employeeId._id || onboarding.employeeId) === String(auth.employeeId);
  const assignee = (onboarding.tasks || []).some((t) => t.assigneeUserId && String(t.assigneeUserId._id || t.assigneeUserId) === String(auth.userId));
  const canView = (auth.permissions || []).some((p) => p === "onboarding.manage" || p === "onboarding.view" || p === "employee.view");
  if (!own && !assignee && !canView) throw AppError.notFound("Onboarding");
  return shape(onboarding, { forEmployee: own && !canView });
}

async function mine(auth) {
  if (!auth.employeeId) return null;
  const row = await Onboarding.findOne({ employeeId: auth.employeeId, status: "in_progress" }).populate(POPULATE).lean();
  return row ? shape(row, { forEmployee: true }) : null;
}

async function myTasks(auth) {
  const rows = await Onboarding.find({ status: "in_progress", "tasks.assigneeUserId": auth.userId }).populate(POPULATE).lean();
  return rows.flatMap((r) => (r.tasks || []).filter((t) => t.status === "pending" && t.assigneeUserId && String(t.assigneeUserId._id || t.assigneeUserId) === String(auth.userId)).map((t) => ({ onboardingId: String(r._id), taskId: String(t._id), title: t.title, owner: t.owner, dueOn: t.dueOn, isOverdue: Boolean(t.dueOn && t.dueOn < dt.todayString()), employee: shapeEmployee(r.employeeId) })));
}

function fullName(e) {
  return e && e.personal ? [e.personal.firstName, e.personal.lastName].filter(Boolean).join(" ") : "";
}

function shapeEmployee(e) {
  if (!e || !e.personal) return { id: String(e) };
  return { id: String(e._id), employeeCode: e.employeeCode, name: fullName(e), department: e.employment && e.employment.departmentId && e.employment.departmentId.name, designation: e.employment && e.employment.designationId && e.employment.designationId.name, joiningDate: e.employment && e.employment.joiningDate, status: e.status, hasPortalAccount: Boolean(e.userId) };
}

function shape(o, { forEmployee = false } = {}) {
  const today = dt.todayString();
  const name = (u) => (u && u.firstName ? [u.firstName, u.lastName].filter(Boolean).join(" ") : null);
  const tasks = (o.tasks || []).map((t) => ({ id: String(t._id), title: t.title, description: t.description, owner: t.owner, assignee: name(t.assigneeUserId), assigneeUserId: t.assigneeUserId ? String(t.assigneeUserId._id || t.assigneeUserId) : null, dueOn: t.dueOn, isOverdue: Boolean(t.status === "pending" && t.dueOn && t.dueOn < today), status: t.status, completedAt: t.completedAt, completedBy: name(t.completedBy), note: t.note, autoComplete: t.autoComplete || "" }));
  const done = tasks.filter((t) => t.status !== "pending").length;
  return {
    id: String(o._id),
    employee: shapeEmployee(o.employeeId),
    templateName: o.templateName,
    joiningDate: o.joiningDate,
    buddy: o.buddyEmployeeId && o.buddyEmployeeId.personal ? shapeEmployee(o.buddyEmployeeId) : null,
    welcomeNote: o.welcomeNote,
    tasks: forEmployee ? tasks.filter((t) => t.owner === "employee") : tasks,
    progress: { done, total: tasks.length, percent: tasks.length ? Math.round((done / tasks.length) * 100) : 0, overdue: tasks.filter((t) => t.isOverdue).length },
    status: o.status,
    completedAt: o.completedAt,
    createdAt: o.createdAt,
  };
}

module.exports = { listTemplates, seedDefault, createTemplate, updateTemplate, deleteTemplate, start, autoStart, completeTask, reassignTask, addTask, update, cancel, runAutoCompletions, sendReminders, list, get, mine, myTasks, Onboarding, OnboardingTemplate };
