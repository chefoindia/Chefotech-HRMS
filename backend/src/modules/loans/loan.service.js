"use strict";

const { Loan } = require("./loan.model");
const Employee = require("../employees/employee.model");
const inputs = require("../payroll/inputs.service");
const notifications = require("../notifications/notification.service");
const recipients = require("../notifications/recipients");
const settings = require("../../core/settings/settings.service");
const { AppError } = require("../../core/errors/AppError");
const { parseListQuery } = require("../../core/http/queryOptions");
const audit = require("../../core/audit/audit.service");
const tenant = require("../../core/tenancy/tenantContext");
const dt = require("../../shared/datetime");

/** Loans and advances. See loan.model.js. */

const POPULATE = [
  { path: "employeeId", select: "employeeCode personal.firstName personal.lastName" },
  { path: "approvedBy", select: "firstName lastName" },
];

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function schedule({ principal, interestRatePercent = 0, instalments, startPeriod }) {
  const years = instalments / 12;
  const interest = round2(principal * (interestRatePercent / 100) * years);
  const total = round2(principal + interest);
  const base = Math.floor((total / instalments) * 100) / 100;
  const rows = [];
  let [year, month] = startPeriod.split("-").map(Number);
  let accumulated = 0;
  for (let i = 0; i < instalments; i += 1) {
    const amount = i === instalments - 1 ? round2(total - accumulated) : base;
    accumulated = round2(accumulated + amount);
    rows.push({ index: i + 1, periodKey: `${year}-${String(month).padStart(2, "0")}`, amount });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return { totalRepayable: total, instalmentAmount: base, interest, rows };
}

async function nextNumber() {
  const last = await Loan.findOne({}).sort({ number: -1 }).select("number").lean();
  return (last ? last.number : 0) + 1;
}

async function limits() {
  const values = await settings.getMany(["loan.max_amount", "loan.max_instalments", "loan.max_active_per_employee"]);
  return { maxAmount: Number(values["loan.max_amount"]) || 0, maxInstalments: Number(values["loan.max_instalments"]) || 60, maxActive: Number(values["loan.max_active_per_employee"]) || 1 };
}

function defaultStartPeriod() {
  const today = dt.todayString();
  let [y, m] = today.slice(0, 7).split("-").map(Number);
  m += 1;
  if (m > 12) {
    m = 1;
    y += 1;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** Employee asks, or HR records one directly (pre-approved). */
async function create(employeeId, data, req, { approve = false } = {}) {
  const employee = await Employee.findById(employeeId).lean();
  if (!employee) throw new AppError("EMPLOYEE_NOT_FOUND");
  const rules = await limits();
  if (rules.maxAmount && data.principal > rules.maxAmount) throw AppError.validation([{ field: "principal", message: `The maximum loan amount is ${rules.maxAmount}` }]);
  if (data.instalments > rules.maxInstalments) throw AppError.validation([{ field: "instalments", message: `At most ${rules.maxInstalments} instalments` }]);
  const active = await Loan.countDocuments({ employeeId, status: { $in: ["requested", "approved", "active"] } });
  if (active >= rules.maxActive) throw AppError.conflict(`This employee already has ${active} open loan${active === 1 ? "" : "s"}; the organization allows ${rules.maxActive}.`);

  const startPeriod = data.startPeriod || defaultStartPeriod();
  const plan = schedule({ principal: data.principal, interestRatePercent: data.interestRatePercent || 0, instalments: data.instalments, startPeriod });

  const loan = await Loan.create({
    number: await nextNumber(),
    employeeId,
    type: data.type || "loan",
    purpose: data.purpose || "",
    principal: data.principal,
    interestRatePercent: data.interestRatePercent || 0,
    instalments: data.instalments,
    totalRepayable: plan.totalRepayable,
    instalmentAmount: plan.instalmentAmount,
    startPeriod,
    status: "requested",
    createdBy: tenant.getUserId(),
  });

  await audit.record({ action: "loan.requested", entityType: "Loan", entityId: loan._id, entityLabel: `${employee.employeeCode} — ${loan.type} ${loan.principal}`, after: { principal: loan.principal, instalments: loan.instalments, startPeriod }, severity: "notice" }, req);

  if (approve) return decide(loan._id, { decision: "approve", comment: "Recorded by HR" }, req);

  const approvers = await recipients.usersWithPermission("loan.approve");
  notifications
    .notify({
      template: "loan_requested",
      recipients: approvers,
      organization: await recipients.organization(),
      data: { employee: { id: String(employee._id), name: [employee.personal.firstName, employee.personal.lastName].filter(Boolean).join(" ") }, loan: { id: String(loan._id), number: loan.number, type: loan.type === "advance" ? "salary advance" : "loan", amount: loan.principal, installments: loan.instalments, purpose: loan.purpose || "—" }, actor: { userId: employee.userId } },
      entity: { type: "Loan", id: loan._id },
    })
    .catch(() => {});
  return shape(await Loan.findById(loan._id).populate(POPULATE).lean());
}

async function decide(id, { decision, comment }, req) {
  const loan = await Loan.findById(id);
  if (!loan) throw AppError.notFound("Loan");
  if (loan.status !== "requested") throw new AppError("WORKFLOW_INVALID_STATE", { message: `This loan has already been ${loan.status}.` });
  const employee = await Employee.findById(loan.employeeId).lean();
  const approved = decision === "approve";

  loan.status = approved ? "approved" : "rejected";
  loan.approvedBy = tenant.getUserId();
  loan.approvedAt = new Date();
  loan.decisionComment = comment || "";
  await loan.save();

  notifications
    .notify({
      template: approved ? "loan_approved" : "loan_rejected",
      recipients: [recipients.employeeToRecipient(employee)],
      organization: await recipients.organization(),
      data: {
        employee: { firstName: employee.personal.firstName },
        loan: { number: loan.number, type: loan.type === "advance" ? "salary advance" : "loan", amount: loan.principal, installments: loan.instalments, installmentAmount: loan.instalmentAmount, startPeriod: loan.startPeriod, note: comment ? ` Note: ${comment}` : "" },
      },
      severity: approved ? "success" : "warning",
      entity: { type: "Loan", id: loan._id },
    })
    .catch(() => {});
  await audit.record({ action: `loan.${approved ? "approved" : "rejected"}`, entityType: "Loan", entityId: loan._id, entityLabel: `${employee.employeeCode} — ${loan.type} ${loan.principal}`, after: { comment }, severity: "notice" }, req);
  return shape(await Loan.findById(loan._id).populate(POPULATE).lean());
}

/** Money handed over: the schedule is filed with payroll from this moment. */
async function disburse(id, { via, reference, disbursedOn }, req) {
  const loan = await Loan.findById(id);
  if (!loan) throw AppError.notFound("Loan");
  if (loan.status !== "approved") throw new AppError("WORKFLOW_INVALID_STATE", { message: "Only an approved loan can be disbursed." });

  loan.status = "active";
  loan.disbursedOn = disbursedOn ? new Date(disbursedOn) : new Date();
  loan.disbursedVia = via;
  loan.disbursementReference = reference || "";
  await loan.save();

  if (via === "payroll") {
    await inputs.add({ employeeId: loan.employeeId, type: "earning", label: `${loan.type === "advance" ? "Salary advance" : "Loan"} #${loan.number} disbursement`, amount: loan.principal, source: { type: "loan_disbursement", id: loan._id, reference: `#${loan.number}` } }, req);
  }
  const plan = schedule({ principal: loan.principal, interestRatePercent: loan.interestRatePercent, instalments: loan.instalments, startPeriod: loan.startPeriod });
  await inputs.addMany(
    plan.rows.map((row) => ({
      employeeId: loan.employeeId,
      type: "deduction",
      label: `${loan.type === "advance" ? "Advance" : "Loan"} #${loan.number} recovery (${row.index}/${loan.instalments})`,
      amount: row.amount,
      periodKey: row.periodKey,
      source: { type: "loan", id: loan._id, reference: `#${loan.number}` },
    }))
  );

  await audit.record({ action: "loan.disbursed", entityType: "Loan", entityId: loan._id, entityLabel: `Loan #${loan.number}`, after: { via, reference, instalments: loan.instalments }, severity: "notice" }, req);
  return withBalance(await Loan.findById(loan._id).populate(POPULATE).lean());
}

/** A repayment outside payroll; the last scheduled instalments are cancelled to match. */
async function recordRepayment(id, { amount, on, reference }, req) {
  const loan = await Loan.findById(id);
  if (!loan) throw AppError.notFound("Loan");
  if (loan.status !== "active") throw AppError.conflict("Only an active loan can take a repayment.");
  loan.manualRepayments.push({ amount, on: on ? new Date(on) : new Date(), reference: reference || "", recordedBy: tenant.getUserId() });
  await loan.save();

  // Cancel scheduled instalments from the end until the repayment is absorbed.
  const pending = await inputs.PayrollInput.find({ "source.type": "loan", "source.id": loan._id, status: "pending" }).sort({ periodKey: -1 }).lean();
  let remaining = amount;
  for (const row of pending) {
    if (remaining <= 0) break;
    if (row.amount <= remaining) {
      await inputs.PayrollInput.updateOne({ _id: row._id }, { $set: { status: "cancelled", cancelledAt: new Date(), cancelReason: `Repaid outside payroll (${reference || "manual"})` } });
      remaining = round2(remaining - row.amount);
    } else {
      await inputs.PayrollInput.updateOne({ _id: row._id }, { $set: { amount: round2(row.amount - remaining) } });
      remaining = 0;
    }
  }
  await audit.record({ action: "loan.repayment_recorded", entityType: "Loan", entityId: loan._id, entityLabel: `Loan #${loan.number}`, after: { amount, reference }, severity: "notice" }, req);
  return maybeClose(loan._id, req);
}

async function maybeClose(id, req) {
  const loan = await Loan.findById(id);
  const { total } = await inputs.pendingTotal("loan", loan._id);
  if (loan.status === "active" && total <= 0) {
    loan.status = "closed";
    loan.closedAt = new Date();
    loan.closeReason = "Fully recovered";
    await loan.save();
    await audit.record({ action: "loan.closed", entityType: "Loan", entityId: loan._id, entityLabel: `Loan #${loan.number}`, severity: "info" }, req);
  }
  return withBalance(await Loan.findById(loan._id).populate(POPULATE).lean());
}

/** Write off or otherwise end early. Remaining instalments are cancelled. */
async function close(id, { reason }, req) {
  const loan = await Loan.findById(id);
  if (!loan) throw AppError.notFound("Loan");
  if (!["requested", "approved", "active"].includes(loan.status)) throw AppError.conflict("This loan is already closed.");
  const cancelled = await inputs.cancelBySource("loan", loan._id, reason || "Loan closed");
  loan.status = loan.status === "requested" ? "cancelled" : "closed";
  loan.closedAt = new Date();
  loan.closeReason = reason || "";
  await loan.save();
  await audit.record({ action: "loan.closed", entityType: "Loan", entityId: loan._id, entityLabel: `Loan #${loan.number}`, after: { reason, cancelledInstalments: cancelled }, severity: "warning" }, req);
  return shape(await Loan.findById(loan._id).populate(POPULATE).lean());
}

async function list(query, auth) {
  const { page, limit, skip } = parseListQuery(query, { allowedSort: ["createdAt"], maxLimit: 200 });
  const filter = {};
  const canManage = (auth.permissions || []).some((p) => p === "loan.manage" || p === "loan.approve");
  if (query.scope === "mine" || !canManage) {
    if (!auth.employeeId) return { items: [], page, limit, total: 0 };
    filter.employeeId = auth.employeeId;
  }
  if (query.employeeId && canManage) filter.employeeId = query.employeeId;
  if (query.status) filter.status = query.status;
  const [rows, total] = await Promise.all([Loan.find(filter).populate(POPULATE).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(), Loan.countDocuments(filter)]);
  const items = await Promise.all(rows.map((r) => withBalance(r)));
  return { items, page, limit, total };
}

async function get(id, auth) {
  const loan = await Loan.findById(id).populate(POPULATE).lean();
  if (!loan) throw AppError.notFound("Loan");
  const own = auth.employeeId && String(loan.employeeId._id || loan.employeeId) === String(auth.employeeId);
  const canManage = (auth.permissions || []).some((p) => p === "loan.manage" || p === "loan.approve");
  if (!own && !canManage) throw AppError.notFound("Loan");
  const rows = await inputs.PayrollInput.find({ "source.type": "loan", "source.id": loan._id }).sort({ periodKey: 1 }).lean();
  return { ...(await withBalance(loan)), schedule: rows.map((r) => ({ id: String(r._id), periodKey: r.periodKey, amount: r.amount, status: r.status, appliedAt: r.appliedAt })) };
}

async function withBalance(loan) {
  const { total: pending, count } = loan.status === "active" ? await inputs.pendingTotal("loan", loan._id) : { total: loan.status === "closed" || loan.status === "rejected" || loan.status === "cancelled" ? 0 : loan.totalRepayable, count: loan.status === "active" ? 0 : loan.instalments };
  return { ...shape(loan), outstanding: round2(pending), instalmentsRemaining: count };
}

/** What an exiting employee still owes — for the settlement statement. */
async function outstandingFor(employeeId) {
  const active = await Loan.find({ employeeId, status: "active" }).select("_id").lean();
  let total = 0;
  for (const loan of active) total += (await inputs.pendingTotal("loan", loan._id)).total;
  return round2(total);
}

function shape(l) {
  const e = l.employeeId && l.employeeId.personal ? l.employeeId : null;
  return {
    id: String(l._id),
    number: l.number,
    type: l.type,
    purpose: l.purpose,
    principal: l.principal,
    interestRatePercent: l.interestRatePercent,
    instalments: l.instalments,
    instalmentAmount: l.instalmentAmount,
    totalRepayable: l.totalRepayable,
    startPeriod: l.startPeriod,
    status: l.status,
    employee: e ? { id: String(e._id), employeeCode: e.employeeCode, name: [e.personal.firstName, e.personal.lastName].filter(Boolean).join(" ") } : { id: String(l.employeeId) },
    approvedBy: l.approvedBy && l.approvedBy.firstName ? [l.approvedBy.firstName, l.approvedBy.lastName].filter(Boolean).join(" ") : null,
    approvedAt: l.approvedAt,
    decisionComment: l.decisionComment,
    disbursedOn: l.disbursedOn,
    disbursedVia: l.disbursedVia,
    disbursementReference: l.disbursementReference,
    manualRepayments: (l.manualRepayments || []).map((r) => ({ amount: r.amount, on: r.on, reference: r.reference })),
    closedAt: l.closedAt,
    closeReason: l.closeReason,
    createdAt: l.createdAt,
  };
}

module.exports = { create, decide, disburse, recordRepayment, close, list, get, outstandingFor, schedule, limits, Loan };
