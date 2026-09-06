"use strict";

const { ExpenseClaim } = require("./expense.model");
const Employee = require("../employees/employee.model");
const workflow = require("../workflow/workflow.service");
const inputs = require("../payroll/inputs.service");
const notifications = require("../notifications/notification.service");
const recipients = require("../notifications/recipients");
const settings = require("../../core/settings/settings.service");
const { AppError } = require("../../core/errors/AppError");
const { parseListQuery } = require("../../core/http/queryOptions");
const audit = require("../../core/audit/audit.service");
const tenant = require("../../core/tenancy/tenantContext");
const { logger } = require("../../config/logger");

/** Expense claims. See expense.model.js. */

const POPULATE = [
  { path: "employeeId", select: "employeeCode personal.firstName personal.lastName employment.departmentId", populate: { path: "employment.departmentId", select: "name" } },
  { path: "decidedBy", select: "firstName lastName" },
  { path: "reimbursement.paidBy", select: "firstName lastName" },
];

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

async function policy() {
  const values = await settings.getMany(["expense.categories", "expense.max_claim_amount", "expense.receipt_required_above", "expense.mileage_rate"]);
  return {
    categories: Array.isArray(values["expense.categories"]) && values["expense.categories"].length ? values["expense.categories"] : ["travel", "food", "accommodation", "fuel", "phone", "office_supplies", "medical", "other"],
    maxClaim: Number(values["expense.max_claim_amount"]) || 0,
    receiptAbove: Number(values["expense.receipt_required_above"]) || 0,
    mileageRate: Number(values["expense.mileage_rate"]) || 0,
  };
}

async function nextNumber() {
  const last = await ExpenseClaim.findOne({}).sort({ number: -1 }).select("number").lean();
  return (last ? last.number : 0) + 1;
}

function computeLines(lines, rules) {
  return lines.map((l) => {
    const amount = l.distanceKm && rules.mileageRate && !l.amount ? round2(l.distanceKm * rules.mileageRate) : round2(l.amount || 0);
    return { ...l, amount };
  });
}

async function validateAgainstPolicy(lines, rules) {
  const problems = [];
  lines.forEach((l, i) => {
    if (!rules.categories.includes(l.category)) problems.push({ field: `lines.${i}.category`, message: `Category must be one of: ${rules.categories.join(", ")}` });
    if (rules.receiptAbove && l.amount > rules.receiptAbove && !l.receiptFileId) problems.push({ field: `lines.${i}.receiptFileId`, message: `A receipt is required for amounts above ${rules.receiptAbove}` });
  });
  const total = lines.reduce((s, l) => s + l.amount, 0);
  if (rules.maxClaim && total > rules.maxClaim) problems.push({ field: "lines", message: `A single claim cannot exceed ${rules.maxClaim}` });
  if (problems.length) throw AppError.validation(problems);
  return round2(total);
}

async function create(employeeId, data, req, { submit = false } = {}) {
  const employee = await Employee.findById(employeeId).lean();
  if (!employee) throw new AppError("EMPLOYEE_NOT_FOUND");
  const rules = await policy();
  const lines = computeLines(data.lines || [], rules);
  const total = submit ? await validateAgainstPolicy(lines, rules) : round2(lines.reduce((s, l) => s + l.amount, 0));

  const claim = await ExpenseClaim.create({
    number: await nextNumber(),
    employeeId,
    title: data.title,
    purpose: data.purpose || "",
    lines,
    total,
    advanceAmount: data.advanceAmount || 0,
    status: "draft",
    createdBy: tenant.getUserId(),
  });
  if (submit) return submitClaim(claim._id, req, { auth: req && req.auth });
  return shape(await ExpenseClaim.findById(claim._id).populate(POPULATE).lean());
}

async function update(id, data, auth, req) {
  const claim = await ExpenseClaim.findById(id);
  if (!claim) throw AppError.notFound("Expense claim");
  assertOwner(claim, auth);
  if (claim.status !== "draft") throw AppError.conflict("Only a draft can be edited. Withdraw the claim to edit it.");
  const rules = await policy();
  if (data.lines) {
    claim.lines = computeLines(data.lines, rules);
    claim.total = round2(claim.lines.reduce((s, l) => s + l.amount, 0));
  }
  for (const key of ["title", "purpose", "advanceAmount"]) if (data[key] !== undefined) claim[key] = data[key];
  await claim.save();
  return shape(await ExpenseClaim.findById(claim._id).populate(POPULATE).lean());
}

function assertOwner(claim, auth) {
  if (!auth || !auth.employeeId || String(claim.employeeId) !== String(auth.employeeId)) {
    if (!auth || !(auth.permissions || []).includes("expense.view")) throw AppError.notFound("Expense claim");
  }
}

async function submitClaim(id, req, { auth } = {}) {
  const claim = await ExpenseClaim.findById(id);
  if (!claim) throw AppError.notFound("Expense claim");
  if (auth) assertOwner(claim, auth);
  if (claim.status !== "draft") throw AppError.conflict("This claim has already been submitted.");
  if (!claim.lines.length) throw AppError.badRequest("Add at least one expense line.");

  const rules = await policy();
  claim.total = await validateAgainstPolicy(claim.lines, rules);
  const employee = await Employee.findById(claim.employeeId).lean();

  const manager = await recipients.managerOf(employee);
  const approvers = manager && manager.userId ? [manager] : await recipients.usersWithPermission("expense.approve");
  claim.approverUserIds = approvers.map((a) => a.userId).filter(Boolean);
  claim.status = "submitted";
  claim.submittedAt = new Date();
  await claim.save();

  const started = await workflow.start(
    { entityType: "expense_claim", entityId: claim._id, entityLabel: `${claim.title} (${claim.total})`, employee, requesterUserId: tenant.getUserId(), context: { total: claim.total, lines: claim.lines.length } },
    req
  );
  if (started.instance) {
    claim.workflowInstanceId = started.instance._id;
    await claim.save();
  } else if (started.autoApproved) {
    await decide(claim._id, { decision: "approve", comment: "Auto-approved by workflow" }, req, { system: true });
  } else {
    notifications
      .notify({
        template: "expense_submitted",
        recipients: approvers,
        organization: await recipients.organization(),
        data: { employee: { id: String(employee._id), name: [employee.personal.firstName, employee.personal.lastName].filter(Boolean).join(" ") }, claim: { id: String(claim._id), number: claim.number, title: claim.title, amount: claim.total, lines: claim.lines.length }, actor: { userId: employee.userId } },
        entity: { type: "ExpenseClaim", id: claim._id },
      })
      .catch((err) => logger.warn({ err }, "Expense notification failed"));
  }

  await audit.record({ action: "expense.submitted", entityType: "ExpenseClaim", entityId: claim._id, entityLabel: `${employee.employeeCode} — ${claim.title}`, after: { total: claim.total, lines: claim.lines.length }, severity: "notice" }, req);
  return shape(await ExpenseClaim.findById(claim._id).populate(POPULATE).lean());
}

async function decide(id, { decision, comment, approvedTotal }, req, { system = false } = {}) {
  const claim = await ExpenseClaim.findById(id);
  if (!claim) throw AppError.notFound("Expense claim");
  if (claim.status !== "submitted") throw new AppError("WORKFLOW_INVALID_STATE", { message: `This claim has already been ${claim.status}.` });

  if (!system) {
    const auth = req.auth;
    const isApprover = claim.approverUserIds.some((id) => String(id) === String(auth.userId));
    if (!isApprover && !(auth.permissions || []).includes("expense.approve")) throw new AppError("NOT_AN_APPROVER");
    if (auth.employeeId && String(claim.employeeId) === String(auth.employeeId)) throw AppError.forbidden("You cannot approve your own claim.");
    if (claim.workflowInstanceId) throw AppError.badRequest("This claim is routed through an approval workflow. Decide it from Approvals.");
  }

  const approved = decision === "approve";
  claim.status = approved ? "approved" : "rejected";
  claim.decidedBy = system ? null : tenant.getUserId();
  claim.decidedByName = system ? "System" : (req && req.auth && req.auth.name) || "";
  claim.decidedAt = new Date();
  claim.decisionComment = comment || "";
  if (approved) claim.approvedTotal = approvedTotal !== undefined && approvedTotal !== null ? Math.min(round2(approvedTotal), claim.total) : claim.total;
  await claim.save();

  const employee = await Employee.findById(claim.employeeId).lean();
  notifications
    .notify({
      template: "expense_decided",
      recipients: [recipients.employeeToRecipient(employee)],
      organization: await recipients.organization(),
      data: { employee: { firstName: employee.personal.firstName }, claim: { title: claim.title, number: claim.number, status: approved ? "approved" : "rejected", amount: approved ? claim.approvedTotal : claim.total, note: comment ? ` Note: ${comment}` : "" } },
      severity: approved ? "success" : "warning",
      entity: { type: "ExpenseClaim", id: claim._id },
    })
    .catch(() => {});

  await audit.record({ action: `expense.${approved ? "approved" : "rejected"}`, entityType: "ExpenseClaim", entityId: claim._id, entityLabel: `${employee.employeeCode} — ${claim.title}`, after: { comment, approvedTotal: claim.approvedTotal }, severity: "notice" }, req);
  return shape(await ExpenseClaim.findById(claim._id).populate(POPULATE).lean());
}

/** Finance pays: through payroll (an earning on the next payslip) or outside it. */
async function reimburse(id, { method, reference }, req) {
  const claim = await ExpenseClaim.findById(id);
  if (!claim) throw AppError.notFound("Expense claim");
  if (claim.status !== "approved") throw new AppError("WORKFLOW_INVALID_STATE", { message: "Only an approved claim can be reimbursed." });

  const payable = round2((claim.approvedTotal ?? claim.total) - (claim.advanceAmount || 0));
  claim.reimbursement = { method, reference: reference || "", paidAt: new Date(), paidBy: tenant.getUserId(), payrollInputId: null };
  if (method === "payroll" && payable > 0) {
    const input = await inputs.add(
      { employeeId: claim.employeeId, type: "earning", label: `Expense reimbursement #${claim.number} — ${claim.title}`, amount: payable, reason: claim.purpose, source: { type: "expense", id: claim._id, reference: `#${claim.number}` } },
      req
    );
    claim.reimbursement.payrollInputId = input._id;
    claim.reimbursement.paidAt = null; // paid when the run is
  }
  claim.status = "reimbursed";
  await claim.save();

  const employee = await Employee.findById(claim.employeeId).lean();
  notifications
    .notify({
      template: "expense_reimbursed",
      recipients: [recipients.employeeToRecipient(employee)],
      organization: await recipients.organization(),
      data: { employee: { firstName: employee.personal.firstName }, claim: { title: claim.title, number: claim.number, amount: payable, how: method === "payroll" ? "will be paid with your next salary" : `has been paid by ${method.replace(/_/g, " ")}${reference ? ` (ref ${reference})` : ""}` } },
      severity: "success",
      entity: { type: "ExpenseClaim", id: claim._id },
    })
    .catch(() => {});

  await audit.record({ action: "expense.reimbursed", entityType: "ExpenseClaim", entityId: claim._id, entityLabel: `${employee.employeeCode} — ${claim.title}`, after: { method, reference, amount: payable }, severity: "notice" }, req);
  return shape(await ExpenseClaim.findById(claim._id).populate(POPULATE).lean());
}

async function withdraw(id, auth, req) {
  const claim = await ExpenseClaim.findById(id);
  if (!claim) throw AppError.notFound("Expense claim");
  assertOwner(claim, auth);
  if (!["draft", "submitted"].includes(claim.status)) throw AppError.conflict("Only a draft or submitted claim can be withdrawn.");
  if (claim.workflowInstanceId) await workflow.cancel(claim.workflowInstanceId, "Withdrawn", req).catch(() => {});
  claim.status = claim.status === "draft" ? "cancelled" : "draft";
  claim.workflowInstanceId = null;
  claim.approverUserIds = [];
  await claim.save();
  await audit.record({ action: "expense.withdrawn", entityType: "ExpenseClaim", entityId: claim._id, entityLabel: claim.title, severity: "info" }, req);
  return shape(await ExpenseClaim.findById(claim._id).populate(POPULATE).lean());
}

async function list(query, auth) {
  const { page, limit, skip } = parseListQuery(query, { allowedSort: ["createdAt", "submittedAt", "total"], maxLimit: 200 });
  const filter = {};
  const canViewAll = (auth.permissions || []).includes("expense.view");
  if (query.scope === "mine" || (!canViewAll && !query.scope)) {
    if (!auth.employeeId) return { items: [], page, limit, total: 0 };
    filter.employeeId = auth.employeeId;
  } else if (query.scope === "to_approve") {
    filter.approverUserIds = auth.userId;
    filter.workflowInstanceId = null;
    if (!query.status) filter.status = "submitted";
  } else if (!canViewAll) {
    filter.$or = [{ employeeId: auth.employeeId }, { approverUserIds: auth.userId }];
  }
  if (query.employeeId && canViewAll) filter.employeeId = query.employeeId;
  if (query.status) filter.status = query.status;

  const [items, total] = await Promise.all([
    ExpenseClaim.find(filter).populate(POPULATE).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    ExpenseClaim.countDocuments(filter),
  ]);
  return { items: items.map(shape), page, limit, total };
}

async function get(id, auth) {
  const claim = await ExpenseClaim.findById(id).populate(POPULATE).lean();
  if (!claim) throw AppError.notFound("Expense claim");
  const own = auth.employeeId && String(claim.employeeId._id || claim.employeeId) === String(auth.employeeId);
  const approver = (claim.approverUserIds || []).some((id) => String(id) === String(auth.userId));
  if (!own && !approver && !(auth.permissions || []).includes("expense.view")) throw AppError.notFound("Expense claim");
  return shape(claim);
}

async function summary() {
  const mongoose = require("mongoose");
  const rows = await ExpenseClaim.aggregate([
    { $match: { organizationId: new mongoose.Types.ObjectId(String(tenant.requireOrganizationId())), status: { $in: ["submitted", "approved"] } } },
    { $group: { _id: "$status", count: { $sum: 1 }, total: { $sum: { $ifNull: ["$approvedTotal", "$total"] } } } },
  ]);
  const by = Object.fromEntries(rows.map((r) => [r._id, r]));
  return { awaitingApproval: by.submitted ? by.submitted.count : 0, awaitingApprovalTotal: by.submitted ? round2(by.submitted.total) : 0, awaitingPayment: by.approved ? by.approved.count : 0, awaitingPaymentTotal: by.approved ? round2(by.approved.total) : 0 };
}

function shape(c) {
  const e = c.employeeId && c.employeeId.personal ? c.employeeId : null;
  return {
    id: String(c._id),
    number: c.number,
    title: c.title,
    purpose: c.purpose,
    lines: (c.lines || []).map((l) => ({ id: String(l._id), date: l.date, category: l.category, description: l.description, amount: l.amount, receiptFileId: l.receiptFileId ? String(l.receiptFileId) : null, distanceKm: l.distanceKm })),
    total: c.total,
    advanceAmount: c.advanceAmount || 0,
    approvedTotal: c.approvedTotal,
    payable: round2((c.approvedTotal ?? c.total) - (c.advanceAmount || 0)),
    status: c.status,
    submittedAt: c.submittedAt,
    employee: e ? { id: String(e._id), employeeCode: e.employeeCode, name: [e.personal.firstName, e.personal.lastName].filter(Boolean).join(" "), department: e.employment && e.employment.departmentId && e.employment.departmentId.name } : { id: String(c.employeeId) },
    approverUserIds: (c.approverUserIds || []).map(String),
    viaWorkflow: Boolean(c.workflowInstanceId),
    decidedBy: c.decidedBy && c.decidedBy.firstName ? [c.decidedBy.firstName, c.decidedBy.lastName].filter(Boolean).join(" ") : c.decidedByName || null,
    decidedAt: c.decidedAt,
    decisionComment: c.decisionComment,
    reimbursement: c.reimbursement && c.reimbursement.method ? { method: c.reimbursement.method, reference: c.reimbursement.reference, paidAt: c.reimbursement.paidAt, viaPayroll: Boolean(c.reimbursement.payrollInputId), paidBy: c.reimbursement.paidBy && c.reimbursement.paidBy.firstName ? [c.reimbursement.paidBy.firstName, c.reimbursement.paidBy.lastName].filter(Boolean).join(" ") : null } : null,
    createdAt: c.createdAt,
  };
}

workflow.onComplete("expense_claim", async (instance, outcome, { reason, req }) => {
  const claim = await ExpenseClaim.findById(instance.entityId);
  if (!claim || claim.status !== "submitted") return;
  if (outcome === "approved" || outcome === "rejected") {
    await decide(claim._id, { decision: outcome === "approved" ? "approve" : "reject", comment: reason || "" }, req, { system: true });
  } else {
    claim.status = "draft";
    claim.workflowInstanceId = null;
    await claim.save();
  }
});

module.exports = { create, update, submitClaim, decide, reimburse, withdraw, list, get, summary, policy, shape, ExpenseClaim };
