"use strict";

const { Asset, AssetAssignment } = require("./asset.model");
const Employee = require("../employees/employee.model");
const notifications = require("../notifications/notification.service");
const recipients = require("../notifications/recipients");
const inputs = require("../payroll/inputs.service");
const { AppError } = require("../../core/errors/AppError");
const { parseListQuery, searchFilter } = require("../../core/http/queryOptions");
const audit = require("../../core/audit/audit.service");
const tenant = require("../../core/tenancy/tenantContext");
const { logger } = require("../../config/logger");

/** Assets and assignments. See asset.model.js. */

const ASSET_POPULATE = [
  { path: "currentEmployeeId", select: "employeeCode personal.firstName personal.lastName" },
  { path: "locationId", select: "name" },
];

async function list(query) {
  const { page, limit, skip, search } = parseListQuery(query, { allowedSort: ["tag", "name", "createdAt", "purchaseDate"], maxLimit: 200 });
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.category) filter.category = query.category;
  if (query.employeeId) filter.currentEmployeeId = query.employeeId;
  if (query.locationId) filter.locationId = query.locationId;
  if (query.warrantyExpiringDays) filter.warrantyUntil = { $ne: null, $lte: new Date(Date.now() + Number(query.warrantyExpiringDays) * 86400000), $gte: new Date() };
  const search$ = searchFilter(search, ["tag", "name", "serialNumber", "make", "model"]);
  const final = search$ ? { $and: [filter, search$] } : filter;
  const [items, total] = await Promise.all([
    Asset.find(final).populate(ASSET_POPULATE).sort({ tag: 1 }).skip(skip).limit(limit).lean(),
    Asset.countDocuments(final),
  ]);
  return { items: items.map(shapeAsset), page, limit, total };
}

async function get(id) {
  const asset = await Asset.findById(id).populate(ASSET_POPULATE).lean();
  if (!asset) throw AppError.notFound("Asset");
  const history = await AssetAssignment.find({ assetId: id })
    .populate({ path: "employeeId", select: "employeeCode personal.firstName personal.lastName" })
    .populate({ path: "returnedTo", select: "firstName lastName" })
    .sort({ assignedOn: -1 })
    .lean();
  return { ...shapeAsset(asset), history: history.map(shapeAssignment) };
}

async function create(data, req) {
  const tag = data.tag || (await nextTag(data.category));
  const asset = await Asset.create({ ...data, tag, createdBy: tenant.getUserId() });
  await audit.record({ action: "asset.created", entityType: "Asset", entityId: asset._id, entityLabel: `${asset.tag} ${asset.name}`, after: { category: asset.category, serialNumber: asset.serialNumber, purchaseCost: asset.purchaseCost }, severity: "notice" }, req);
  return shapeAsset(await Asset.findById(asset._id).populate(ASSET_POPULATE).lean());
}

async function nextTag(category) {
  const prefix = { laptop: "LT", desktop: "DT", monitor: "MN", phone: "PH", sim: "SIM", id_card: "ID", access_card: "AC", vehicle: "VH", furniture: "FN", tool: "TL", uniform: "UF", software_licence: "SW" }[category] || "AS";
  const count = await Asset.countDocuments({ tag: new RegExp(`^${prefix}-`) });
  return `${prefix}-${String(count + 1).padStart(4, "0")}`;
}

async function update(id, data, req) {
  const asset = await Asset.findById(id);
  if (!asset) throw AppError.notFound("Asset");
  const before = { name: asset.name, status: asset.status, condition: asset.condition };
  if (data.status && data.status === "assigned") throw AppError.badRequest("Use Assign to hand an asset to someone.");
  if (data.status && asset.status === "assigned" && data.status !== "assigned") throw AppError.badRequest("Record the return first; the asset is with someone.");
  Object.assign(asset, data, { updatedBy: tenant.getUserId() });
  await asset.save();
  await audit.record({ action: "asset.updated", entityType: "Asset", entityId: asset._id, entityLabel: `${asset.tag} ${asset.name}`, before, after: { name: asset.name, status: asset.status, condition: asset.condition }, skipIfUnchanged: true }, req);
  return shapeAsset(await Asset.findById(asset._id).populate(ASSET_POPULATE).lean());
}

async function remove(id, req) {
  const asset = await Asset.findById(id);
  if (!asset) throw AppError.notFound("Asset");
  if (asset.status === "assigned") throw AppError.conflict("Record the return before retiring an asset that is with someone.");
  await asset.softDelete(tenant.getUserId());
  await audit.record({ action: "asset.deleted", entityType: "Asset", entityId: asset._id, entityLabel: `${asset.tag} ${asset.name}`, severity: "warning" }, req);
  return { id: String(asset._id), deleted: true };
}

async function assign(id, { employeeId, assignedOn, expectedReturnOn, condition, notes }, req) {
  const asset = await Asset.findById(id);
  if (!asset) throw AppError.notFound("Asset");
  if (asset.status === "assigned") throw AppError.conflict("This asset is already with someone. Record its return first.");
  if (["lost", "retired"].includes(asset.status)) throw AppError.conflict(`A ${asset.status} asset cannot be assigned.`);
  const employee = await Employee.findById(employeeId).lean();
  if (!employee) throw new AppError("EMPLOYEE_NOT_FOUND");

  const assignment = await AssetAssignment.create({
    assetId: asset._id,
    employeeId,
    assignedOn: assignedOn ? new Date(assignedOn) : new Date(),
    expectedReturnOn: expectedReturnOn ? new Date(expectedReturnOn) : null,
    conditionAtAssignment: condition || asset.condition,
    notes: notes || "",
    createdBy: tenant.getUserId(),
  });
  asset.status = "assigned";
  asset.currentAssignmentId = assignment._id;
  asset.currentEmployeeId = employeeId;
  if (condition) asset.condition = condition;
  await asset.save();

  await audit.record({ action: "asset.assigned", entityType: "Asset", entityId: asset._id, entityLabel: `${asset.tag} ${asset.name} → ${employee.employeeCode}`, after: { employeeId: String(employeeId), expectedReturnOn }, severity: "notice" }, req);

  notifications
    .notify({
      template: "asset_assigned",
      recipients: [recipients.employeeToRecipient(employee)],
      organization: await recipients.organization(),
      data: { employee: { firstName: employee.personal.firstName }, asset: { id: String(asset._id), tag: asset.tag, name: asset.name, category: asset.category.replace(/_/g, " "), returnNote: expectedReturnOn ? ` Please return it by ${String(expectedReturnOn).slice(0, 10)}.` : "" } },
      entity: { type: "Asset", id: asset._id },
    })
    .catch((err) => logger.warn({ err }, "Asset notification failed"));

  return get(asset._id);
}

/** The employee confirms receipt. */
async function acknowledge(assignmentId, auth, { name } = {}) {
  const assignment = await AssetAssignment.findById(assignmentId);
  if (!assignment) throw AppError.notFound("Assignment");
  if (!auth.employeeId || String(assignment.employeeId) !== String(auth.employeeId)) throw AppError.forbidden("You can only acknowledge assets assigned to you.");
  if (!assignment.acknowledgedAt) {
    assignment.acknowledgedAt = new Date();
    assignment.acknowledgedName = (name || auth.name || "").slice(0, 120);
    await assignment.save();
  }
  return { acknowledged: true, at: assignment.acknowledgedAt };
}

async function recordReturn(id, { returnedOn, condition, notes, recoveryAmount, newStatus }, req) {
  const asset = await Asset.findById(id);
  if (!asset) throw AppError.notFound("Asset");
  if (asset.status !== "assigned" || !asset.currentAssignmentId) throw AppError.conflict("This asset is not currently assigned.");
  const assignment = await AssetAssignment.findById(asset.currentAssignmentId);
  if (!assignment) throw AppError.notFound("Assignment");

  assignment.returnedOn = returnedOn ? new Date(returnedOn) : new Date();
  assignment.conditionAtReturn = condition || asset.condition;
  assignment.returnNotes = notes || "";
  assignment.returnedTo = tenant.getUserId();
  if (recoveryAmount > 0) {
    const input = await inputs.add(
      { employeeId: assignment.employeeId, type: "deduction", label: `Asset recovery — ${asset.tag} ${asset.name}`, amount: recoveryAmount, reason: notes || condition || "", source: { type: "asset", id: assignment._id, reference: asset.tag } },
      req
    );
    assignment.recoveryAmount = recoveryAmount;
    assignment.recoveryInputId = input._id;
  }
  await assignment.save();

  asset.status = newStatus && ["in_repair", "lost", "retired"].includes(newStatus) ? newStatus : "available";
  asset.condition = condition || asset.condition;
  asset.currentAssignmentId = null;
  asset.currentEmployeeId = null;
  await asset.save();

  await audit.record({ action: "asset.returned", entityType: "Asset", entityId: asset._id, entityLabel: `${asset.tag} ${asset.name}`, after: { condition, recoveryAmount: recoveryAmount || 0, status: asset.status }, severity: "notice" }, req);
  return get(asset._id);
}

/** Everything currently with one employee — the profile tab and the exit checklist. */
async function forEmployee(employeeId) {
  const rows = await AssetAssignment.find({ employeeId, returnedOn: null })
    .populate({ path: "assetId", select: "tag name category serialNumber condition status" })
    .sort({ assignedOn: -1 })
    .lean();
  return rows.filter((r) => r.assetId).map((r) => ({ ...shapeAssignment(r), asset: { id: String(r.assetId._id), tag: r.assetId.tag, name: r.assetId.name, category: r.assetId.category, serialNumber: r.assetId.serialNumber, condition: r.assetId.condition } }));
}

async function stats() {
  const mongoose = require("mongoose");
  const rows = await Asset.aggregate([{ $match: { organizationId: new mongoose.Types.ObjectId(String(tenant.requireOrganizationId())), deletedAt: null } }, { $group: { _id: "$status", count: { $sum: 1 }, value: { $sum: { $ifNull: ["$purchaseCost", 0] } } } }]);
  const by = Object.fromEntries(rows.map((r) => [r._id, r]));
  const total = rows.reduce((s, r) => s + r.count, 0);
  const soon = new Date(Date.now() + 30 * 86400000);
  const [warrantyExpiring, overdueReturns] = await Promise.all([
    Asset.countDocuments({ warrantyUntil: { $ne: null, $lte: soon, $gte: new Date() } }),
    AssetAssignment.countDocuments({ returnedOn: null, expectedReturnOn: { $ne: null, $lt: new Date() } }),
  ]);
  return { total, available: by.available ? by.available.count : 0, assigned: by.assigned ? by.assigned.count : 0, inRepair: by.in_repair ? by.in_repair.count : 0, lost: by.lost ? by.lost.count : 0, retired: by.retired ? by.retired.count : 0, totalValue: rows.reduce((s, r) => s + (r.value || 0), 0), warrantyExpiring, overdueReturns };
}

/** Remind people whose expected return date has passed. Daily job. */
async function sendReturnReminders() {
  const overdue = await AssetAssignment.find({ returnedOn: null, expectedReturnOn: { $ne: null, $lt: new Date() }, $or: [{ reminderSentAt: null }, { reminderSentAt: { $lt: new Date(Date.now() - 3 * 86400000) } }] })
    .populate({ path: "assetId", select: "tag name" })
    .populate({ path: "employeeId", select: "userId personal.firstName personal.lastName personal.workEmail" })
    .limit(200)
    .lean();
  const organization = await recipients.organization();
  let sent = 0;
  for (const row of overdue) {
    if (!row.employeeId || !row.assetId) continue;
    await notifications
      .notify({ template: "asset_return_due", recipients: [recipients.employeeToRecipient(row.employeeId)], organization, data: { employee: { firstName: row.employeeId.personal.firstName }, asset: { tag: row.assetId.tag, name: row.assetId.name, dueDate: new Date(row.expectedReturnOn).toISOString().slice(0, 10) } }, severity: "warning", entity: { type: "Asset", id: row.assetId._id } })
      .catch(() => {});
    await AssetAssignment.updateOne({ _id: row._id }, { $set: { reminderSentAt: new Date() } });
    sent += 1;
  }
  return { checked: overdue.length, sent };
}

function shapeAsset(a) {
  const e = a.currentEmployeeId && a.currentEmployeeId.personal ? a.currentEmployeeId : null;
  return {
    id: String(a._id),
    tag: a.tag,
    name: a.name,
    category: a.category,
    make: a.make,
    model: a.model,
    serialNumber: a.serialNumber,
    purchaseDate: a.purchaseDate,
    purchaseCost: a.purchaseCost,
    vendor: a.vendor,
    warrantyUntil: a.warrantyUntil,
    warrantyExpired: Boolean(a.warrantyUntil && new Date(a.warrantyUntil) < new Date()),
    location: a.locationId && a.locationId.name ? { id: String(a.locationId._id), name: a.locationId.name } : null,
    notes: a.notes,
    status: a.status,
    condition: a.condition,
    assignedTo: e ? { id: String(e._id), employeeCode: e.employeeCode, name: [e.personal.firstName, e.personal.lastName].filter(Boolean).join(" ") } : null,
    currentAssignmentId: a.currentAssignmentId ? String(a.currentAssignmentId) : null,
    createdAt: a.createdAt,
  };
}

function shapeAssignment(r) {
  const e = r.employeeId && r.employeeId.personal ? r.employeeId : null;
  return {
    id: String(r._id),
    assetId: String(r.assetId && r.assetId._id ? r.assetId._id : r.assetId),
    employee: e ? { id: String(e._id), employeeCode: e.employeeCode, name: [e.personal.firstName, e.personal.lastName].filter(Boolean).join(" ") } : { id: String(r.employeeId) },
    assignedOn: r.assignedOn,
    expectedReturnOn: r.expectedReturnOn,
    isOverdue: Boolean(!r.returnedOn && r.expectedReturnOn && new Date(r.expectedReturnOn) < new Date()),
    conditionAtAssignment: r.conditionAtAssignment,
    notes: r.notes,
    acknowledgedAt: r.acknowledgedAt,
    acknowledgedName: r.acknowledgedName,
    returnedOn: r.returnedOn,
    conditionAtReturn: r.conditionAtReturn,
    returnNotes: r.returnNotes,
    returnedTo: r.returnedTo && r.returnedTo.firstName ? [r.returnedTo.firstName, r.returnedTo.lastName].filter(Boolean).join(" ") : null,
    recoveryAmount: r.recoveryAmount || 0,
  };
}

module.exports = { list, get, create, update, remove, assign, acknowledge, recordReturn, forEmployee, stats, sendReturnReminders, Asset, AssetAssignment };
