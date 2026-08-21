"use strict";

const mongoose = require("mongoose");
const Employee = require("./employee.model");
const customFields = require("./customField.service");
const User = require("../users/user.model");
const Membership = require("../rbac/membership.model");
const Role = require("../rbac/role.model");
const Department = require("../departments/department.model");
const Designation = require("../designations/designation.model");
const Location = require("../locations/location.model");
const Organization = require("../organizations/organization.model");
const organizationService = require("../organizations/organization.service");
const settings = require("../../core/settings/settings.service");
const storage = require("../../core/storage/storage.service");
const notifications = require("../notifications/notification.service");
const { assertLimit } = require("../organizations/planGuard");
const { AppError } = require("../../core/errors/AppError");
const { parseListQuery, searchFilter } = require("../../core/http/queryOptions");
const audit = require("../../core/audit/audit.service");
const tenant = require("../../core/tenancy/tenantContext");
const { env } = require("../../config/env");
const { logger } = require("../../config/logger");

/**
 * Employee lifecycle.
 *
 * Two rules run through everything here:
 *
 *   1. SCOPE. What a caller may see is decided by `scopeFilter` and applied as
 *      part of the Mongo query, never by fetching everything and filtering in
 *      JavaScript. A manager asking for page 3 of the employee list gets page
 *      3 of *their team*, with a correct total.
 *
 *   2. SENSITIVITY. Bank, statutory and identity data is stripped in
 *      `presentFor` unless the caller holds employee.view_sensitive. The
 *      stripping happens on the way out, in one place, so a new endpoint
 *      cannot forget to do it.
 */

const SENSITIVE_GROUPS = ["bank", "statutory", "identityDocuments"];

// ── Access scope ────────────────────────────────────────────────────────────

/**
 * Build the Mongo filter describing which employees `auth` may see.
 *
 * org  — everyone (employee.view)
 * team — the caller's reporting tree, plus themselves
 * self — only their own record
 */
function scopeFilter(auth) {
  const permissions = auth.permissions || [];

  if (permissions.includes("employee.view")) return { scope: "org", filter: {} };

  const selfId = auth.employeeId ? new mongoose.Types.ObjectId(auth.employeeId) : null;

  if (permissions.includes("attendance.view_team") || permissions.includes("leave.view_team") || auth.isManager) {
    if (!selfId) return { scope: "self", filter: { _id: null } };
    return {
      scope: "team",
      filter: {
        $or: [{ _id: selfId }, { "employment.managerChain": selfId }],
      },
    };
  }

  if (!selfId) return { scope: "self", filter: { _id: null } };
  return { scope: "self", filter: { _id: selfId } };
}

/** Throw unless `auth` is allowed to see this specific employee. */
async function assertCanView(auth, employeeId) {
  const { filter } = scopeFilter(auth);
  const found = await Employee.findOne({
    $and: [{ _id: employeeId }, filter],
  })
    .select("_id")
    .lean();
  // 404, not 403 — a manager should not learn that an employee exists in
  // another department by probing ids.
  if (!found) throw new AppError("EMPLOYEE_NOT_FOUND");
}

// ── Employee code generation ────────────────────────────────────────────────

/**
 * Next employee code, from the tenant's numbering configuration.
 *
 * Retries on collision rather than trusting the counter, because a manually
 * created code can occupy a number the counter has not reached yet.
 */
async function generateEmployeeCode() {
  const config = await settings.getMany([
    "employee.code_prefix",
    "employee.code_padding",
    "employee.code_next_number",
    "employee.code_auto_generate",
  ]);

  if (!config["employee.code_auto_generate"]) return null;

  const prefix = config["employee.code_prefix"] || "";
  const padding = config["employee.code_padding"] || 4;
  let next = config["employee.code_next_number"] || 1;

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const code = `${prefix}${String(next).padStart(padding, "0")}`;
    const exists = await Employee.findOne({ employeeCode: code })
      .withDeleted()
      .select("_id")
      .lean();
    if (!exists) {
      await settings.set("employee.code_next_number", next + 1);
      return code;
    }
    next += 1;
  }
  throw AppError.conflict("Could not generate a unique employee code. Check the numbering settings.");
}

// ── Reporting line ──────────────────────────────────────────────────────────

/**
 * Resolve the manager chain, refusing to create a cycle.
 * A -> B -> A would make "my team" recurse forever and break every scope query.
 */
async function resolveManagerChain(managerId, selfId) {
  if (!managerId) return [];

  const manager = await Employee.findById(managerId)
    .select("employment.managerChain")
    .lean();
  if (!manager) throw AppError.badRequest("The selected manager does not exist.");

  const chain = [...(manager.employment.managerChain || []), manager._id];

  if (selfId && chain.some((id) => String(id) === String(selfId))) {
    throw AppError.badRequest(
      "That reporting line loops back to this employee. Pick a different manager."
    );
  }
  return chain;
}

/** After a manager change, every descendant's chain has to be rebuilt. */
async function rebuildSubtree(employeeId) {
  const reports = await Employee.find({ "employment.managerId": employeeId })
    .select("_id")
    .lean();

  for (const report of reports) {
    const chain = await resolveManagerChain(employeeId, report._id);
    await Employee.updateOne(
      { _id: report._id },
      { $set: { "employment.managerChain": chain } }
    );
    await rebuildSubtree(report._id);
  }
}

// ── Presentation ────────────────────────────────────────────────────────────

/** Shape an employee for the wire, honouring the viewer's permissions. */
async function presentFor(employee, auth, { includeCustomFields = true } = {}) {
  if (!employee) return null;
  const doc = employee.toObject ? employee.toObject() : { ...employee };
  const canSeeSensitive = (auth.permissions || []).includes("employee.view_sensitive");
  const isSelf = auth.employeeId && String(auth.employeeId) === String(doc._id);

  const out = {
    ...doc,
    id: String(doc._id),
    fullName:
      (doc.personal && doc.personal.displayName) ||
      [doc.personal && doc.personal.firstName, doc.personal && doc.personal.lastName]
        .filter(Boolean)
        .join(" "),
  };

  // People can always see their own bank and identity details.
  if (!canSeeSensitive && !isSelf) {
    for (const group of SENSITIVE_GROUPS) delete out[group];
    out.sensitiveHidden = true;
  }

  if (doc.avatarFileId) {
    const file = await storage.StoredFile.findById(doc.avatarFileId).lean().catch(() => null);
    out.avatarUrl = file
      ? storage.publicImageUrl(file, { width: 200 })
      : null;
  } else {
    out.avatarUrl = null;
  }

  if (includeCustomFields) {
    out.customFields = await customFields.filterForViewer(
      doc.customFields,
      canSeeSensitive || isSelf
    );
  }

  delete out.__v;
  delete out._id;
  return out;
}

// ── Queries ─────────────────────────────────────────────────────────────────

const LIST_POPULATE = [
  { path: "employment.departmentId", select: "name code" },
  { path: "employment.designationId", select: "name code grade" },
  { path: "employment.locationId", select: "name code" },
  { path: "employment.managerId", select: "employeeCode personal.firstName personal.lastName" },
];

async function list(query, auth) {
  const { page, limit, skip, sort, search } = parseListQuery(query, {
    allowedSort: [
      "employeeCode",
      "personal.firstName",
      "personal.lastName",
      "employment.joiningDate",
      "createdAt",
      "status",
    ],
    defaultSort: "employeeCode",
  });

  const { filter: scope, scope: scopeName } = scopeFilter(auth);
  const filter = { ...scope };
  const and = [];

  if (query.status) {
    filter.status = Array.isArray(query.status) ? { $in: query.status } : query.status;
  } else if (query.includeInactive !== "true") {
    // The default list is people who currently work here.
    filter.status = { $in: ["active", "on_leave", "notice_period", "suspended", "invited"] };
  }

  if (query.departmentId) filter["employment.departmentId"] = query.departmentId;
  if (query.designationId) filter["employment.designationId"] = query.designationId;
  if (query.locationId) filter["employment.locationId"] = query.locationId;
  if (query.managerId) filter["employment.managerId"] = query.managerId;
  if (query.employmentType) filter["employment.employmentType"] = query.employmentType;
  if (query.tag) filter.tags = query.tag;

  if (query.joinedFrom || query.joinedTo) {
    filter["employment.joiningDate"] = {};
    if (query.joinedFrom) filter["employment.joiningDate"].$gte = new Date(query.joinedFrom);
    if (query.joinedTo) filter["employment.joiningDate"].$lte = new Date(query.joinedTo);
  }

  const search$ = searchFilter(search, [
    "employeeCode",
    "biometricId",
    "personal.firstName",
    "personal.lastName",
    "personal.displayName",
    "personal.workEmail",
    "personal.phone",
  ]);
  if (search$) and.push(search$);

  const finalFilter = and.length ? { $and: [filter, ...and] } : filter;

  const [rows, total] = await Promise.all([
    Employee.find(finalFilter)
      .populate(LIST_POPULATE)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Employee.countDocuments(finalFilter),
  ]);

  const items = await Promise.all(rows.map((r) => presentFor(r, auth, { includeCustomFields: false })));
  return { items, page, limit, total, scope: scopeName };
}

async function getById(employeeId, auth) {
  await assertCanView(auth, employeeId);

  const employee = await Employee.findById(employeeId).populate(LIST_POPULATE);
  if (!employee) throw new AppError("EMPLOYEE_NOT_FOUND");

  return presentFor(employee, auth);
}

// ── Mutations ───────────────────────────────────────────────────────────────

async function create(data, req) {
  const organization = await Organization.findById(tenant.requireOrganizationId()).lean();
  const activeCount = await Employee.countDocuments({
    status: { $in: ["active", "on_leave", "notice_period", "suspended", "invited"] },
  });
  assertLimit(organization, "employees", activeCount, 1);

  const employeeCode = data.employeeCode || (await generateEmployeeCode());
  if (!employeeCode) {
    throw AppError.validation([
      { field: "employeeCode", message: "An employee code is required (auto-numbering is off)" },
    ]);
  }

  const duplicate = await Employee.findOne({ employeeCode }).withDeleted().select("_id").lean();
  if (duplicate) throw new AppError("DUPLICATE_EMPLOYEE_CODE");

  await assertReferencesExist(data.employment || {});

  const custom = await customFields.validateValues(data.customFields || {}, { partial: false });
  const managerChain = await resolveManagerChain(
    data.employment && data.employment.managerId,
    null
  );

  const status = data.status || "active";
  const employee = await Employee.create({
    ...data,
    employeeCode,
    customFields: custom,
    status,
    statusHistory: [
      {
        status,
        effectiveFrom: (data.employment && data.employment.joiningDate) || new Date(),
        reason: "Employee record created",
        changedBy: tenant.getUserId(),
      },
    ],
    employment: { ...(data.employment || {}), managerChain },
    createdBy: tenant.getUserId(),
    updatedBy: tenant.getUserId(),
  });

  await bumpCounts(employee, 1);
  await organizationService.markStepCompleteIfPending("employees");

  await audit.record(
    {
      action: "employee.created",
      entityType: "Employee",
      entityId: employee._id,
      entityLabel: `${employee.employeeCode} — ${employee.fullName}`,
      after: redactForAudit(employee.toObject()),
      severity: "notice",
    },
    req
  );

  if (data.sendInvite && data.personal && data.personal.workEmail) {
    await invite(employee._id, { roleKey: data.inviteRoleKey }, req).catch((err) =>
      logger.warn({ err, employeeId: String(employee._id) }, "Employee invite failed")
    );
  }

  return employee;
}

async function update(employeeId, data, req, auth) {
  const employee = await Employee.findById(employeeId);
  if (!employee) throw new AppError("EMPLOYEE_NOT_FOUND");

  const before = employee.toObject();

  if (data.employeeCode && data.employeeCode !== employee.employeeCode) {
    const clash = await Employee.findOne({
      employeeCode: data.employeeCode,
      _id: { $ne: employee._id },
    })
      .withDeleted()
      .select("_id")
      .lean();
    if (clash) throw new AppError("DUPLICATE_EMPLOYEE_CODE");
  }

  if (data.employment) await assertReferencesExist(data.employment);

  if (data.customFields) {
    const custom = await customFields.validateValues(data.customFields, {
      partial: true,
      employeeId: employee._id,
    });
    for (const [key, value] of Object.entries(custom)) employee.customFields.set(key, value);
    delete data.customFields;
  }

  const managerChanged =
    data.employment &&
    data.employment.managerId !== undefined &&
    String(data.employment.managerId || "") !== String(employee.employment.managerId || "");

  // Status changes go through changeStatus so the history is always written.
  if (data.status && data.status !== employee.status) {
    throw AppError.badRequest(
      "Use the status endpoint to change an employee's employment status."
    );
  }

  deepAssign(employee, data);
  employee.updatedBy = tenant.getUserId();

  if (managerChanged) {
    employee.employment.managerChain = await resolveManagerChain(
      employee.employment.managerId,
      employee._id
    );
  }

  await employee.save();

  if (managerChanged) await rebuildSubtree(employee._id);

  await audit.record(
    {
      action: "employee.updated",
      entityType: "Employee",
      entityId: employee._id,
      entityLabel: `${employee.employeeCode} — ${employee.fullName}`,
      before: redactForAudit(before),
      after: redactForAudit(employee.toObject()),
      severity: "notice",
      skipIfUnchanged: true,
    },
    req
  );

  return presentFor(employee, auth || { permissions: ["employee.view_sensitive"] });
}

/**
 * Self-service update. The set of editable paths is a tenant setting, so what
 * an employee may change about themselves is configuration, not code.
 */
async function updateOwnProfile(employeeId, data, req) {
  const allowed = await settings.get("employee.self_editable_fields");
  const employee = await Employee.findById(employeeId);
  if (!employee) throw new AppError("EMPLOYEE_NOT_FOUND");

  const before = employee.toObject();
  const applied = [];
  const rejected = [];

  const flat = flatten(data);
  for (const [path, value] of Object.entries(flat)) {
    const permitted = allowed.some((p) => path === p || path.startsWith(`${p}.`));
    if (!permitted) {
      rejected.push(path);
      continue;
    }
    setPath(employee, path, value);
    applied.push(path);
  }

  if (!applied.length) {
    throw AppError.forbidden("None of those fields can be edited from your profile.");
  }

  employee.updatedBy = tenant.getUserId();
  await employee.save();

  await audit.record(
    {
      action: "employee.self_updated",
      entityType: "Employee",
      entityId: employee._id,
      entityLabel: `${employee.employeeCode} — ${employee.fullName}`,
      before: redactForAudit(before),
      after: redactForAudit(employee.toObject()),
      severity: "info",
      skipIfUnchanged: true,
    },
    req
  );

  return { applied, rejected };
}

const ALLOWED_TRANSITIONS = {
  draft: ["invited", "active", "inactive"],
  invited: ["active", "inactive"],
  active: ["on_leave", "suspended", "notice_period", "resigned", "terminated", "inactive"],
  on_leave: ["active", "suspended", "notice_period", "resigned", "terminated"],
  suspended: ["active", "terminated", "inactive"],
  notice_period: ["resigned", "terminated", "active"],
  resigned: ["inactive", "active"], // rehire
  terminated: ["inactive", "active"],
  inactive: ["active"],
};

async function changeStatus(employeeId, { status, effectiveFrom, reason, exit }, req) {
  const employee = await Employee.findById(employeeId);
  if (!employee) throw new AppError("EMPLOYEE_NOT_FOUND");

  if (employee.status === status) {
    throw AppError.badRequest(`This employee is already ${status.replace(/_/g, " ")}.`);
  }

  const allowed = ALLOWED_TRANSITIONS[employee.status] || [];
  if (!allowed.includes(status)) {
    throw AppError.conflict(
      `An employee who is ${employee.status.replace(/_/g, " ")} cannot move directly to ${status.replace(/_/g, " ")}.`,
      { allowed }
    );
  }

  const previous = employee.status;
  employee.status = status;
  employee.statusHistory.push({
    status,
    effectiveFrom: effectiveFrom || new Date(),
    reason: reason || "",
    changedBy: tenant.getUserId(),
  });

  if (exit) employee.exit = { ...(employee.exit || {}), ...exit };
  employee.updatedBy = tenant.getUserId();
  await employee.save();

  // Leaving revokes portal access; the login itself survives because the
  // person may still belong to another organization.
  const isLeaving = ["resigned", "terminated", "inactive"].includes(status);
  if (isLeaving && employee.userId) {
    await Membership.updateOne(
      { userId: employee.userId },
      { $set: { status: "suspended" } }
    );
    const rbac = require("../rbac/rbac.service");
    rbac.invalidateUser(String(tenant.requireOrganizationId()), String(employee.userId));
  }
  if (status === "active" && employee.userId) {
    await Membership.updateOne({ userId: employee.userId }, { $set: { status: "active" } });
  }

  await bumpCounts(employee, isLeaving ? -1 : 0);

  await audit.record(
    {
      action: "employee.status_changed",
      entityType: "Employee",
      entityId: employee._id,
      entityLabel: `${employee.employeeCode} — ${employee.fullName}`,
      before: { status: previous },
      after: { status, effectiveFrom, reason },
      severity: isLeaving ? "warning" : "notice",
      description: `Status changed from ${previous} to ${status}`,
    },
    req
  );

  return employee;
}

/** Create the login for an employee and email them an invitation. */
async function invite(employeeId, { roleKey } = {}, req) {
  const employee = await Employee.findById(employeeId);
  if (!employee) throw new AppError("EMPLOYEE_NOT_FOUND");

  const email = employee.personal.workEmail || employee.personal.personalEmail;
  if (!email) {
    throw AppError.badRequest("Add a work email address before inviting this employee.");
  }

  const organizationId = tenant.requireOrganizationId();
  const organization = await Organization.findById(organizationId).lean();

  const role = roleKey
    ? await Role.findOne({ key: roleKey })
    : await Role.findOne({ isDefault: true });
  if (!role) throw AppError.badRequest("No default role is configured for new users.");

  // The person may already have a Chefotech login from another organization.
  let user = await User.findOne({ email });
  const token = User.generateToken();

  if (!user) {
    user = new User({
      email,
      firstName: employee.personal.firstName,
      lastName: employee.personal.lastName,
      phone: employee.personal.phone,
      status: "invited",
    });
  }
  user.invitationTokenHash = token.hash;
  user.invitationExpiresAt = new Date(Date.now() + 7 * 86400000);
  user.lastOrganizationId = user.lastOrganizationId || organizationId;
  await user.save();

  const existingMembership = await Membership.findOne({ userId: user._id });
  if (existingMembership) {
    existingMembership.roleIds = [role._id];
    existingMembership.permissions = role.permissions;
    existingMembership.employeeId = employee._id;
    if (existingMembership.status === "removed") existingMembership.status = "invited";
    await existingMembership.save();
  } else {
    await Membership.create({
      organizationId,
      userId: user._id,
      employeeId: employee._id,
      roleIds: [role._id],
      permissions: role.permissions,
      status: "invited",
      invitedBy: tenant.getUserId(),
      invitedAt: new Date(),
    });
  }

  employee.userId = user._id;
  if (employee.status === "draft") employee.status = "invited";
  await employee.save();

  await notifications.sendTransactional({
    to: email,
    template: "user_invitation",
    organizationId,
    data: {
      firstName: employee.personal.firstName,
      inviterName: (req && req.auth && req.auth.name) || "Your administrator",
      roleName: role.name,
      acceptUrl: `${env.app.publicUrl}/accept-invitation?token=${token.plain}`,
      expiresInDays: 7,
      company: { name: organization.name },
    },
  });

  await audit.record(
    {
      action: "employee.invited",
      entityType: "Employee",
      entityId: employee._id,
      entityLabel: `${employee.employeeCode} — ${employee.fullName}`,
      after: { email, role: role.name },
      severity: "notice",
    },
    req
  );

  return { invited: true, email, roleName: role.name };
}

async function setAvatar(employeeId, file, req) {
  const employee = await Employee.findById(employeeId);
  if (!employee) throw new AppError("EMPLOYEE_NOT_FOUND");

  const organization = await Organization.findById(tenant.requireOrganizationId()).lean();

  const stored = await storage.save({
    buffer: file.buffer,
    originalName: file.originalname,
    mimeType: file.mimetype,
    category: "avatar",
    ownerType: "Employee",
    ownerId: employee._id,
    orgFolderName: `${organization.slug}-${String(organization._id).slice(-6)}`,
  });

  const previous = employee.avatarFileId;
  employee.avatarFileId = stored._id;
  await employee.save();

  if (previous) {
    const old = await storage.StoredFile.findById(previous);
    if (old) await storage.destroy(old, tenant.getUserId()).catch(() => {});
  }

  await audit.record(
    {
      action: "employee.avatar_updated",
      entityType: "Employee",
      entityId: employee._id,
      entityLabel: employee.employeeCode,
      severity: "info",
    },
    req
  );

  return { avatarUrl: storage.publicImageUrl(stored, { width: 200 }), fileId: String(stored._id) };
}

/** The reporting tree beneath one employee. */
async function team(employeeId, { depth = 1 } = {}) {
  const filter =
    depth === 1
      ? { "employment.managerId": employeeId }
      : { "employment.managerChain": employeeId };

  return Employee.find({
    ...filter,
    status: { $in: ["active", "on_leave", "notice_period"] },
  })
    .select("employeeCode personal.firstName personal.lastName personal.displayName avatarFileId employment.designationId employment.departmentId status")
    .populate([
      { path: "employment.designationId", select: "name" },
      { path: "employment.departmentId", select: "name" },
    ])
    .sort({ employeeCode: 1 })
    .lean();
}

async function headcountStats() {
  const [byStatus, byDepartment, byType, byLocation] = await Promise.all([
    Employee.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    Employee.aggregate([
      { $match: { status: { $in: ["active", "on_leave", "notice_period"] } } },
      { $group: { _id: "$employment.departmentId", count: { $sum: 1 } } },
      { $lookup: { from: "departments", localField: "_id", foreignField: "_id", as: "department" } },
      { $project: { count: 1, name: { $ifNull: [{ $first: "$department.name" }, "Unassigned"] } } },
      { $sort: { count: -1 } },
    ]),
    Employee.aggregate([
      { $match: { status: { $in: ["active", "on_leave", "notice_period"] } } },
      { $group: { _id: "$employment.employmentType", count: { $sum: 1 } } },
    ]),
    Employee.aggregate([
      { $match: { status: { $in: ["active", "on_leave", "notice_period"] } } },
      { $group: { _id: "$employment.locationId", count: { $sum: 1 } } },
      { $lookup: { from: "locations", localField: "_id", foreignField: "_id", as: "location" } },
      { $project: { count: 1, name: { $ifNull: [{ $first: "$location.name" }, "Unassigned"] } } },
      { $sort: { count: -1 } },
    ]),
  ]);

  const statusMap = Object.fromEntries(byStatus.map((r) => [r._id, r.count]));
  const active =
    (statusMap.active || 0) + (statusMap.on_leave || 0) + (statusMap.notice_period || 0);

  return {
    total: byStatus.reduce((sum, r) => sum + r.count, 0),
    active,
    byStatus: statusMap,
    byDepartment,
    byLocation,
    byEmploymentType: Object.fromEntries(byType.map((r) => [r._id, r.count])),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function assertReferencesExist(employment) {
  const checks = [
    [employment.departmentId, Department, "department"],
    [employment.designationId, Designation, "designation"],
    [employment.locationId, Location, "work location"],
  ];
  for (const [id, model, label] of checks) {
    if (!id) continue;
    const exists = await model.findById(id).select("_id").lean();
    if (!exists) throw AppError.badRequest(`The selected ${label} does not exist.`);
  }
}

async function bumpCounts(employee, delta) {
  if (!delta) return;
  const e = employee.employment || {};
  await Promise.all([
    e.departmentId && Department.updateOne({ _id: e.departmentId }, { $inc: { employeeCount: delta } }),
    e.designationId && Designation.updateOne({ _id: e.designationId }, { $inc: { employeeCount: delta } }),
    e.locationId && Location.updateOne({ _id: e.locationId }, { $inc: { employeeCount: delta } }),
  ].filter(Boolean));
}

/** Never write account numbers or identity numbers into the audit trail. */
function redactForAudit(doc) {
  const copy = { ...doc };
  if (copy.bank) {
    copy.bank = {
      ...copy.bank,
      accountNumber: copy.bank.accountNumber ? "[redacted]" : "",
    };
  }
  if (copy.identityDocuments) {
    copy.identityDocuments = copy.identityDocuments.map((d) => ({
      ...d,
      number: "[redacted]",
    }));
  }
  if (copy.statutory) {
    copy.statutory = { ...copy.statutory, taxId: copy.statutory.taxId ? "[redacted]" : "" };
  }
  delete copy.customFields; // may contain tenant-defined sensitive values
  return copy;
}

/** Merge nested plain objects without clobbering untouched sub-documents. */
function deepAssign(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    if (value === undefined) continue;
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      !(value instanceof Date) &&
      target[key] &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      deepAssign(target[key], value);
    } else {
      target[key] = value;
    }
  }
  return target;
}

function flatten(obj, prefix = "") {
  const out = {};
  for (const [key, value] of Object.entries(obj || {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
      Object.assign(out, flatten(value, path));
    } else {
      out[path] = value;
    }
  }
  return out;
}

function setPath(doc, path, value) {
  const parts = path.split(".");
  let cursor = doc;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (cursor[parts[i]] === undefined || cursor[parts[i]] === null) cursor[parts[i]] = {};
    cursor = cursor[parts[i]];
  }
  cursor[parts[parts.length - 1]] = value;
  if (doc.markModified) doc.markModified(parts[0]);
}

module.exports = {
  list,
  getById,
  create,
  update,
  updateOwnProfile,
  changeStatus,
  invite,
  setAvatar,
  team,
  headcountStats,
  scopeFilter,
  assertCanView,
  presentFor,
  generateEmployeeCode,
  resolveManagerChain,
  rebuildSubtree,
  ALLOWED_TRANSITIONS,
  Employee,
};
