"use strict";

const { EmployeeRequest } = require("./request.model");
const { TYPES } = require("./request.types");
const Employee = require("../employees/employee.model");
const workflow = require("../workflow/workflow.service");
const notifications = require("../notifications/notification.service");
const recipients = require("../notifications/recipients");
const { AppError } = require("../../core/errors/AppError");
const { parseListQuery } = require("../../core/http/queryOptions");
const audit = require("../../core/audit/audit.service");
const tenant = require("../../core/tenancy/tenantContext");
const { logger } = require("../../config/logger");

/**
 * Employee requests: submit, decide, apply. See request.model.js.
 *
 * Approval path: if the organization has configured a workflow for the
 * request's entity type, that runs and its completion decides the request.
 * Otherwise the type's default approver decides directly — the reporting
 * manager, or anyone holding request.approve for HR-owned types.
 */

const ENTITY_TYPES = {
  wfh: "wfh_request",
  comp_off: "comp_off_request",
  encashment: "encashment_request",
  shift_swap: "shift_swap_request",
  letter: "letter_request",
  profile_change: "profile_change_request",
  advance: "advance_request",
  other: "other_request",
};

async function submit(employeeId, { type, payload, reason, attachmentFileId }, req) {
  const definition = TYPES[type];
  if (!definition) throw AppError.badRequest(`Unknown request type '${type}'.`);

  const parsed = definition.schema.safeParse(payload || {});
  if (!parsed.success) {
    throw AppError.validation(parsed.error.issues.map((i) => ({ field: `payload.${i.path.join(".")}`, message: i.message })));
  }

  const employee = await Employee.findById(employeeId).lean();
  if (!employee) throw new AppError("EMPLOYEE_NOT_FOUND");

  const duplicate = await EmployeeRequest.findOne({ employeeId, type, status: "pending" }).lean();
  if (duplicate && ["wfh", "comp_off", "shift_swap"].includes(type)) {
    const same = JSON.stringify(duplicate.payload) === JSON.stringify(parsed.data);
    if (same) throw AppError.conflict("You already have an identical request waiting for a decision.");
  }

  const approvers = await resolveApprovers(definition.approver, employee);

  const request = await EmployeeRequest.create({
    employeeId,
    type,
    payload: parsed.data,
    reason: reason || "",
    attachmentFileId: attachmentFileId || null,
    summary: definition.summary(parsed.data),
    approverUserIds: approvers.map((a) => a.userId).filter(Boolean),
    createdBy: tenant.getUserId(),
  });

  // A configured workflow takes over the decision.
  const started = await workflow.start(
    { entityType: ENTITY_TYPES[type], entityId: request._id, entityLabel: request.summary, employee, requesterUserId: tenant.getUserId(), context: { type, ...parsed.data } },
    req
  );
  if (started.instance) {
    request.workflowInstanceId = started.instance._id;
    await request.save();
  } else if (started.autoApproved) {
    await decide(request._id, { decision: "approve", comment: "Auto-approved by workflow" }, req, { system: true });
  } else {
    await notifyApprovers(request, employee, approvers);
  }

  await audit.record(
    { action: "request.submitted", entityType: "EmployeeRequest", entityId: request._id, entityLabel: `${employee.employeeCode} — ${request.summary}`, after: { type, payload: parsed.data }, severity: "notice" },
    req
  );

  return shape(await EmployeeRequest.findById(request._id).populate(POPULATE).lean());
}

async function resolveApprovers(mode, employee) {
  if (mode === "manager") {
    const manager = await recipients.managerOf(employee);
    if (manager && manager.userId) return [manager];
  }
  // HR-owned types, and managerless employees, go to whoever can approve.
  return recipients.usersWithPermission("request.approve");
}

async function notifyApprovers(request, employee, approvers) {
  if (!approvers.length) return;
  await notifications
    .notify({
      template: "request_submitted",
      recipients: approvers,
      organization: await recipients.organization(),
      data: {
        employee: { id: String(employee._id), name: [employee.personal.firstName, employee.personal.lastName].filter(Boolean).join(" ") },
        request: { id: String(request._id), type: TYPES[request.type].label, summary: request.summary, reason: request.reason, reasonNote: request.reason ? ` Reason: ${request.reason}` : "" },
        actor: { userId: employee.userId, employeeId: employee._id },
      },
      entity: { type: "EmployeeRequest", id: request._id },
    })
    .catch((err) => logger.warn({ err }, "Request notification failed"));
}

const POPULATE = [
  { path: "employeeId", select: "employeeCode personal.firstName personal.lastName employment.departmentId", populate: { path: "employment.departmentId", select: "name" } },
  { path: "decidedBy", select: "firstName lastName" },
];

/**
 * Decide. Allowed for a listed approver, anyone with request.approve, or
 * the system (workflow completion, auto-approval).
 */
async function decide(requestId, { decision, comment }, req, { system = false } = {}) {
  const request = await EmployeeRequest.findById(requestId);
  if (!request) throw AppError.notFound("Request");
  if (request.status !== "pending") throw new AppError("WORKFLOW_INVALID_STATE", { message: `This request has already been ${request.status}.` });

  if (!system) {
    const auth = req.auth;
    const isApprover = request.approverUserIds.some((id) => String(id) === String(auth.userId));
    const canApprove = (auth.permissions || []).includes("request.approve");
    if (!isApprover && !canApprove) throw new AppError("NOT_AN_APPROVER");
    if (request.workflowInstanceId) {
      throw AppError.badRequest("This request is routed through an approval workflow. Decide it from Approvals.");
    }
  }

  const employee = await Employee.findById(request.employeeId).lean();
  const approved = decision === "approve";

  request.status = approved ? "approved" : "rejected";
  request.decidedBy = system ? null : tenant.getUserId();
  request.decidedByName = system ? "System" : (req && req.auth && req.auth.name) || "";
  request.decidedAt = new Date();
  request.decisionComment = comment || "";

  if (approved) {
    try {
      request.effect = await TYPES[request.type].apply(request, employee, req);
      request.status = "completed";
      request.completedAt = new Date();
    } catch (err) {
      // Approved but not applied: HR sees why and can fix the data and retry.
      logger.warn({ err, requestId: String(request._id) }, "Approved request could not be applied");
      request.effect = { error: err.message };
    }
  }
  await request.save();

  await notifications
    .notify({
      template: approved ? "request_approved" : "request_rejected",
      recipients: [recipients.employeeToRecipient(employee)],
      organization: await recipients.organization(),
      data: {
        employee: { firstName: employee.personal.firstName },
        request: {
          type: TYPES[request.type].label,
          label: request.summary,
          summary: request.summary,
          note: comment ? ` Note: ${comment}` : "",
          reasonNote: comment ? ` Reason: ${comment}` : "",
          effectNote: request.effect && request.effect.error ? ` It could not be applied automatically (${request.effect.error}); HR will follow up.` : "",
        },
      },
      severity: approved ? "success" : "warning",
      entity: { type: "EmployeeRequest", id: request._id },
    })
    .catch(() => {});

  await audit.record(
    { action: `request.${approved ? "approved" : "rejected"}`, entityType: "EmployeeRequest", entityId: request._id, entityLabel: `${employee.employeeCode} — ${request.summary}`, after: { comment, effect: request.effect }, severity: "notice" },
    req
  );

  return shape(await EmployeeRequest.findById(request._id).populate(POPULATE).lean());
}

/** Retry the effect of an approved-but-unapplied request after fixing the data. */
async function retryApply(requestId, req) {
  const request = await EmployeeRequest.findById(requestId);
  if (!request) throw AppError.notFound("Request");
  if (request.status !== "approved") throw AppError.badRequest("Only an approved request that has not been applied can be retried.");
  const employee = await Employee.findById(request.employeeId).lean();
  request.effect = await TYPES[request.type].apply(request, employee, req);
  request.status = "completed";
  request.completedAt = new Date();
  await request.save();
  return shape(await EmployeeRequest.findById(request._id).populate(POPULATE).lean());
}

async function cancel(requestId, auth, req) {
  const request = await EmployeeRequest.findById(requestId);
  if (!request) throw AppError.notFound("Request");
  const own = auth.employeeId && String(request.employeeId) === String(auth.employeeId);
  if (!own && !(auth.permissions || []).includes("request.view")) throw AppError.forbidden();
  if (request.status !== "pending") throw new AppError("WORKFLOW_INVALID_STATE", { message: "Only a pending request can be withdrawn." });
  if (request.workflowInstanceId) await workflow.cancel(request.workflowInstanceId, "Withdrawn by the requester", req).catch(() => {});
  request.status = "cancelled";
  request.cancelledAt = new Date();
  await request.save();
  await audit.record({ action: "request.cancelled", entityType: "EmployeeRequest", entityId: request._id, entityLabel: request.summary, severity: "notice" }, req);
  return shape(await EmployeeRequest.findById(request._id).populate(POPULATE).lean());
}

async function list(query, auth) {
  const { page, limit, skip } = parseListQuery(query, { allowedSort: ["createdAt"], maxLimit: 200 });
  const filter = {};
  const canViewAll = (auth.permissions || []).includes("request.view");

  if (query.scope === "mine" || (!canViewAll && !query.scope)) {
    if (!auth.employeeId) return { items: [], page, limit, total: 0 };
    filter.employeeId = auth.employeeId;
  } else if (query.scope === "to_approve") {
    filter.approverUserIds = auth.userId;
    filter.workflowInstanceId = null;
    if (!query.status) filter.status = "pending";
  } else if (!canViewAll) {
    // A manager without request.view sees their own and what they must decide.
    filter.$or = [{ employeeId: auth.employeeId }, { approverUserIds: auth.userId }];
  }
  if (query.employeeId && canViewAll) filter.employeeId = query.employeeId;
  if (query.status) filter.status = query.status;
  if (query.type) filter.type = query.type;

  const [items, total] = await Promise.all([
    EmployeeRequest.find(filter).populate(POPULATE).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    EmployeeRequest.countDocuments(filter),
  ]);
  return { items: items.map(shape), page, limit, total };
}

async function get(requestId, auth) {
  const request = await EmployeeRequest.findById(requestId).populate(POPULATE).lean();
  if (!request) throw AppError.notFound("Request");
  const own = auth.employeeId && String(request.employeeId._id || request.employeeId) === String(auth.employeeId);
  const approver = request.approverUserIds.some((id) => String(id) === String(auth.userId));
  if (!own && !approver && !(auth.permissions || []).includes("request.view")) throw AppError.notFound("Request");
  return shape(request);
}

function shape(r) {
  const e = r.employeeId && r.employeeId.personal ? r.employeeId : null;
  return {
    id: String(r._id),
    type: r.type,
    typeLabel: TYPES[r.type] ? TYPES[r.type].label : r.type,
    payload: r.payload,
    reason: r.reason,
    summary: r.summary,
    status: r.status,
    attachmentFileId: r.attachmentFileId ? String(r.attachmentFileId) : null,
    employee: e
      ? { id: String(e._id), employeeCode: e.employeeCode, name: [e.personal.firstName, e.personal.lastName].filter(Boolean).join(" "), department: e.employment && e.employment.departmentId && e.employment.departmentId.name }
      : { id: String(r.employeeId) },
    approverUserIds: (r.approverUserIds || []).map(String),
    viaWorkflow: Boolean(r.workflowInstanceId),
    decidedBy: r.decidedBy && r.decidedBy.firstName ? [r.decidedBy.firstName, r.decidedBy.lastName].filter(Boolean).join(" ") : r.decidedByName || null,
    decidedAt: r.decidedAt,
    decisionComment: r.decisionComment,
    effect: r.effect,
    createdAt: r.createdAt,
  };
}

/** Workflow completion feeds back into the same decision path. */
for (const [type, entityType] of Object.entries(ENTITY_TYPES)) {
  workflow.onComplete(entityType, async (instance, outcome, { reason, req }) => {
    const request = await EmployeeRequest.findById(instance.entityId);
    if (!request || request.status !== "pending") return;
    if (outcome === "approved" || outcome === "rejected") {
      await decide(request._id, { decision: outcome === "approved" ? "approve" : "reject", comment: reason || "" }, req, { system: true });
    } else {
      request.status = "cancelled";
      request.cancelledAt = new Date();
      await request.save();
    }
    void type;
  });
}

module.exports = { submit, decide, retryApply, cancel, list, get, shape, ENTITY_TYPES, EmployeeRequest };
