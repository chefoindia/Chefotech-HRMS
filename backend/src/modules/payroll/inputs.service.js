"use strict";

const PayrollInput = require("./payrollInput.model");
const Employee = require("../employees/employee.model");
const { AppError } = require("../../core/errors/AppError");
const { parseListQuery } = require("../../core/http/queryOptions");
const audit = require("../../core/audit/audit.service");
const tenant = require("../../core/tenancy/tenantContext");

/**
 * Payroll inputs — see payrollInput.model.js for what they are.
 */

async function add({ employeeId, type, label, amount, reason = "", periodKey = null, source = null }, req) {
  const employee = await Employee.findById(employeeId).select("employeeCode").lean();
  if (!employee) throw new AppError("EMPLOYEE_NOT_FOUND");
  if (!(amount > 0)) throw AppError.badRequest("The amount must be more than zero.");

  const input = await PayrollInput.create({
    employeeId,
    type,
    label,
    amount: Math.round(amount * 100) / 100,
    reason,
    periodKey: periodKey || null,
    source: source ? { type: source.type || "manual", id: source.id || null, reference: source.reference || "" } : { type: "manual" },
    createdBy: tenant.getUserId(),
  });

  await audit.record(
    {
      action: "payroll.input_added",
      entityType: "PayrollInput",
      entityId: input._id,
      entityLabel: `${employee.employeeCode} — ${label}`,
      after: { type, amount: input.amount, periodKey: input.periodKey, source: input.source.type },
      severity: "notice",
    },
    req
  );
  return input;
}

/** Several inputs at once, e.g. a loan's whole instalment schedule. */
async function addMany(rows) {
  if (!rows.length) return [];
  return PayrollInput.insertMany(
    rows.map((r) => ({
      organizationId: tenant.requireOrganizationId(),
      employeeId: r.employeeId,
      type: r.type,
      label: r.label,
      amount: Math.round(r.amount * 100) / 100,
      reason: r.reason || "",
      periodKey: r.periodKey || null,
      source: r.source ? { type: r.source.type || "manual", id: r.source.id || null, reference: r.source.reference || "" } : { type: "manual" },
      createdBy: tenant.getUserId(),
    }))
  );
}

/** The inputs a run should apply for one employee: pending, and due by this period. */
async function pendingFor(employeeId, periodKey) {
  return PayrollInput.find({
    employeeId,
    status: "pending",
    $or: [{ periodKey: null }, { periodKey: { $lte: periodKey } }],
  })
    .sort({ periodKey: 1, createdAt: 1 })
    .lean();
}

async function markApplied(ids, { runId, itemId }) {
  if (!ids.length) return;
  await PayrollInput.updateMany({ _id: { $in: ids } }, { $set: { status: "applied", appliedRunId: runId, appliedItemId: itemId, appliedAt: new Date() } });
}

/** A run being reprocessed releases whatever it applied last time. */
async function releaseRun(runId) {
  const result = await PayrollInput.updateMany(
    { appliedRunId: runId, status: "applied" },
    { $set: { status: "pending", appliedRunId: null, appliedItemId: null, appliedAt: null } }
  );
  return result.modifiedCount || 0;
}

async function cancel(id, reason, req) {
  const input = await PayrollInput.findById(id);
  if (!input) throw AppError.notFound("Payroll input");
  if (input.status === "applied") throw AppError.conflict("This input has already been applied to a payroll run. Reprocess or adjust that run instead.");
  input.status = "cancelled";
  input.cancelledAt = new Date();
  input.cancelReason = reason || "";
  await input.save();
  await audit.record({ action: "payroll.input_cancelled", entityType: "PayrollInput", entityId: input._id, entityLabel: input.label, after: { reason }, severity: "notice" }, req);
  return input;
}

/** Cancel every pending input a source created (a loan closed early, a claim withdrawn). */
async function cancelBySource(type, id, reason = "") {
  const result = await PayrollInput.updateMany(
    { "source.type": type, "source.id": id, status: "pending" },
    { $set: { status: "cancelled", cancelledAt: new Date(), cancelReason: reason } }
  );
  return result.modifiedCount || 0;
}

async function list(query = {}) {
  const { page, limit, skip } = parseListQuery(query, { allowedSort: ["createdAt"], maxLimit: 200 });
  const filter = {};
  if (query.employeeId) filter.employeeId = query.employeeId;
  if (query.status) filter.status = query.status;
  if (query.sourceType) filter["source.type"] = query.sourceType;
  if (query.periodKey) filter.periodKey = query.periodKey;
  const [items, total] = await Promise.all([
    PayrollInput.find(filter)
      .populate({ path: "employeeId", select: "employeeCode personal.firstName personal.lastName" })
      .sort({ status: 1, periodKey: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    PayrollInput.countDocuments(filter),
  ]);
  return { items: items.map(shape), page, limit, total };
}

function shape(i) {
  const e = i.employeeId && i.employeeId.personal ? i.employeeId : null;
  return {
    id: String(i._id),
    employeeId: e ? String(e._id) : String(i.employeeId),
    employee: e ? { id: String(e._id), employeeCode: e.employeeCode, name: [e.personal.firstName, e.personal.lastName].filter(Boolean).join(" ") } : null,
    type: i.type,
    label: i.label,
    amount: i.amount,
    reason: i.reason,
    periodKey: i.periodKey,
    source: i.source,
    status: i.status,
    appliedRunId: i.appliedRunId ? String(i.appliedRunId) : null,
    appliedAt: i.appliedAt,
    createdAt: i.createdAt,
  };
}

/**
 * Total still pending for a source — a loan's outstanding balance, for
 * instance. Aggregation pipelines do not cast, so the tenant id has to be
 * a real ObjectId here rather than the string the context carries.
 */
async function pendingTotal(type, id) {
  const mongoose = require("mongoose");
  const rows = await PayrollInput.aggregate([
    { $match: { organizationId: new mongoose.Types.ObjectId(String(tenant.requireOrganizationId())), "source.type": type, "source.id": new mongoose.Types.ObjectId(String(id)), status: "pending" } },
    { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
  ]);
  return rows[0] ? { total: Math.round(rows[0].total * 100) / 100, count: rows[0].count } : { total: 0, count: 0 };
}

module.exports = { add, addMany, pendingFor, markApplied, releaseRun, cancel, cancelBySource, list, pendingTotal, shape, PayrollInput };
