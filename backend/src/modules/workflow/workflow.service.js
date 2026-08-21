"use strict";

const { Workflow, WorkflowInstance, ApprovalDelegation } = require("./workflow.model");
const Employee = require("../employees/employee.model");
const Membership = require("../rbac/membership.model");
const Organization = require("../organizations/organization.model");
const notifications = require("../notifications/notification.service");
const formula = require("../../core/rules/formula");
const { AppError } = require("../../core/errors/AppError");
const { parseListQuery } = require("../../core/http/queryOptions");
const audit = require("../../core/audit/audit.service");
const tenant = require("../../core/tenancy/tenantContext");
const { logger } = require("../../config/logger");
const dt = require("../../shared/datetime");

/**
 * The workflow engine.
 *
 * Modules call `start()` when a request is raised and register a completion
 * handler; the engine resolves approvers, advances steps, applies conditions,
 * handles escalation and delegation, and calls back when the outcome is known.
 *
 * Approvers are resolved at the moment a step ACTIVATES, not when the workflow
 * is defined. If someone changes manager between raising a request and the
 * step being reached, the request goes to the new manager — which is what
 * anyone looking at it would expect.
 */

const completionHandlers = new Map();

/**
 * Register what happens when an instance finishes.
 * @param {string} entityType
 * @param {(instance, outcome, context) => Promise<void>} handler
 */
function onComplete(entityType, handler) {
  completionHandlers.set(entityType, handler);
}

/** The workflow that governs this request, or null if approvals are direct. */
async function resolveWorkflow(entityType, employee) {
  const candidates = await Workflow.find({ entityType, isActive: true })
    .sort({ priority: 1, createdAt: 1 })
    .lean();

  if (!candidates.length) return null;

  const departmentId = String((employee.employment && employee.employment.departmentId) || "");
  const locationId = String((employee.employment && employee.employment.locationId) || "");
  const employmentType = (employee.employment && employee.employment.employmentType) || "";

  // The most specific match wins; a default with no restrictions is the
  // fallback, which is why it sorts last by priority.
  for (const workflow of candidates) {
    const applies = workflow.appliesTo || {};
    const departmentOk =
      !applies.departmentIds ||
      !applies.departmentIds.length ||
      applies.departmentIds.map(String).includes(departmentId);
    const locationOk =
      !applies.locationIds ||
      !applies.locationIds.length ||
      applies.locationIds.map(String).includes(locationId);
    const typeOk =
      !applies.employmentTypes ||
      !applies.employmentTypes.length ||
      applies.employmentTypes.includes(employmentType);

    if (departmentOk && locationOk && typeOk) return workflow;
  }

  return candidates.find((w) => w.isDefault) || null;
}

/** Who approves at this step, right now. */
async function resolveApprovers(step, employee, requesterUserId) {
  const userIds = new Set();

  switch (step.approverType) {
    case "reporting_manager": {
      const managerId = employee.employment && employee.employment.managerId;
      if (managerId) {
        const manager = await Employee.findById(managerId).select("userId").lean();
        if (manager && manager.userId) userIds.add(String(manager.userId));
      }
      break;
    }

    case "manager_level": {
      const chain = (employee.employment && employee.employment.managerChain) || [];
      // The chain is ordered root-first, so level 1 is the last entry.
      const index = chain.length - (step.managerLevel || 1);
      if (index >= 0) {
        const manager = await Employee.findById(chain[index]).select("userId").lean();
        if (manager && manager.userId) userIds.add(String(manager.userId));
      }
      break;
    }

    case "department_head": {
      const Department = require("../departments/department.model");
      const department = await Department.findById(
        employee.employment && employee.employment.departmentId
      )
        .select("headEmployeeId")
        .lean();
      if (department && department.headEmployeeId) {
        const head = await Employee.findById(department.headEmployeeId).select("userId").lean();
        if (head && head.userId) userIds.add(String(head.userId));
      }
      break;
    }

    case "role": {
      const memberships = await Membership.find({
        roleIds: { $in: step.roleIds || [] },
        status: "active",
      })
        .select("userId")
        .lean();
      for (const m of memberships) userIds.add(String(m.userId));
      break;
    }

    case "permission": {
      const memberships = await Membership.find({
        permissions: step.permission,
        status: "active",
      })
        .select("userId")
        .limit(50)
        .lean();
      for (const m of memberships) userIds.add(String(m.userId));
      break;
    }

    case "specific_users":
      for (const id of step.userIds || []) userIds.add(String(id));
      break;

    case "requester":
      if (requesterUserId) userIds.add(String(requesterUserId));
      break;

    default:
      break;
  }

  // Nobody approves their own request unless the step explicitly says so.
  if (step.skipIfSelf !== false && requesterUserId) {
    userIds.delete(String(requesterUserId));
  }

  return [...userIds].map((id) => applyDelegation(id));
}

/** Swap an approver for their delegate if one is active today. */
const delegationCache = { at: 0, rows: [] };

async function loadDelegations() {
  if (Date.now() - delegationCache.at < 60_000) return delegationCache.rows;
  const today = dt.todayString(await organizationTimezone());
  delegationCache.rows = await ApprovalDelegation.find({
    isActive: true,
    fromDate: { $lte: today },
    toDate: { $gte: today },
  }).lean();
  delegationCache.at = Date.now();
  return delegationCache.rows;
}

function applyDelegation(userId) {
  const row = delegationCache.rows.find((d) => String(d.fromUserId) === String(userId));
  return row ? String(row.toUserId) : userId;
}

async function organizationTimezone() {
  const org = await tenant.runAsSystem(
    () => Organization.findById(tenant.requireOrganizationId()).select("timezone").lean(),
    "workflow.timezone"
  );
  return (org && org.timezone) || dt.DEFAULT_TZ;
}

/**
 * Start an approval.
 *
 * @returns {Promise<{instance, autoApproved: boolean}>}
 *          `autoApproved` when there is no workflow or every step was skipped,
 *          so the caller can settle the request immediately.
 */
async function start({ entityType, entityId, entityLabel, employee, requesterUserId, context = {} }, req) {
  const workflow = await resolveWorkflow(entityType, employee);

  if (!workflow || !workflow.steps.length) {
    return { instance: null, autoApproved: false, hasWorkflow: false };
  }

  await loadDelegations();

  const instance = await WorkflowInstance.create({
    workflowId: workflow._id,
    entityType,
    entityId,
    entityLabel: entityLabel || "",
    requesterEmployeeId: employee._id,
    requesterUserId: requesterUserId || null,
    context,
    status: "pending",
    currentStepOrder: 0,
    steps: workflow.steps
      .sort((a, b) => a.order - b.order)
      .map((step) => ({
        order: step.order,
        name: step.name,
        status: "waiting",
        mode: step.mode,
        approverUserIds: [],
        decisions: [],
      })),
  });

  const advanced = await advance(instance, workflow, employee, req);
  return { instance: advanced.instance, autoApproved: advanced.completed && advanced.outcome === "approved", hasWorkflow: true };
}

/**
 * Move to the next step that actually needs a decision.
 * Steps whose condition is false, or whose approver set is empty, are skipped.
 */
async function advance(instance, workflow, employee, req) {
  const definitions = (workflow.steps || []).sort((a, b) => a.order - b.order);

  for (const definition of definitions) {
    const stepState = instance.steps.find((s) => s.order === definition.order);
    if (!stepState || ["approved", "skipped", "auto_approved"].includes(stepState.status)) continue;
    if (stepState.status === "pending") return { instance, completed: false };

    // Condition
    if (definition.condition) {
      let passes = true;
      try {
        passes = Boolean(
          formula.evaluate(definition.condition, instance.context || {}, { strict: false }).value
        );
      } catch (err) {
        // A broken condition must not strand the request forever; err toward
        // asking a human rather than silently approving.
        logger.warn(
          { err, workflow: workflow.code, step: definition.name },
          "Workflow step condition failed to evaluate; the step will run"
        );
      }
      if (!passes) {
        stepState.status = "skipped";
        stepState.skipReason = `Condition not met: ${definition.condition}`;
        stepState.completedAt = new Date();
        continue;
      }
    }

    const approvers = await resolveApprovers(definition, employee, instance.requesterUserId);

    if (!approvers.length) {
      stepState.status = "skipped";
      stepState.skipReason = "No approver could be resolved for this step";
      stepState.completedAt = new Date();
      logger.warn(
        { workflow: workflow.code, step: definition.name, instance: String(instance._id) },
        "Workflow step skipped: no approver resolved"
      );
      continue;
    }

    stepState.status = "pending";
    stepState.approverUserIds = approvers;
    stepState.startedAt = new Date();
    if (definition.escalateAfterDays || definition.autoApproveAfterDays) {
      const days = definition.escalateAfterDays || definition.autoApproveAfterDays;
      stepState.dueAt = new Date(Date.now() + days * 86400000);
    }

    instance.currentStepOrder = definition.order;
    await instance.save();

    await notifyApprovers(instance, stepState, req);
    return { instance, completed: false };
  }

  // Every step is resolved.
  return complete(instance, "approved", "", req);
}

async function notifyApprovers(instance, stepState, req) {
  const User = require("../users/user.model");
  const users = await User.find({ _id: { $in: stepState.approverUserIds } })
    .select("email firstName")
    .lean();

  const organization = await tenant.runAsSystem(
    () => Organization.findById(tenant.requireOrganizationId()).lean(),
    "workflow.notify"
  );

  const requester = await Employee.findById(instance.requesterEmployeeId)
    .select("personal.firstName personal.lastName")
    .lean();

  await notifications
    .notify({
      template: "approval_pending",
      recipients: users.map((u) => ({ userId: u._id, email: u.email, firstName: u.firstName })),
      organization,
      data: {
        request: {
          type: humanEntityType(instance.entityType),
          requesterName: requester
            ? [requester.personal.firstName, requester.personal.lastName].filter(Boolean).join(" ")
            : "An employee",
          url: urlFor(instance),
        },
      },
      entity: { type: "WorkflowInstance", id: instance._id },
    })
    .catch((err) => logger.warn({ err }, "Approval notification failed"));
}

function humanEntityType(entityType) {
  return String(entityType).replace(/_/g, " ");
}

function urlFor(instance) {
  const routes = {
    leave_request: "/app/approvals",
    attendance_correction: "/app/attendance/corrections",
    expense_claim: "/app/approvals",
  };
  return routes[instance.entityType] || `/app/approvals/${instance._id}`;
}

/** Record one approver's decision. */
async function decide(instanceId, { decision, comment }, userId, req) {
  const instance = await WorkflowInstance.findById(instanceId);
  if (!instance) throw AppError.notFound("Approval");
  if (instance.status !== "pending") {
    throw new AppError("WORKFLOW_INVALID_STATE", {
      message: `This request has already been ${instance.status}.`,
    });
  }

  const stepState = instance.steps.find((s) => s.order === instance.currentStepOrder);
  if (!stepState || stepState.status !== "pending") {
    throw new AppError("WORKFLOW_INVALID_STATE");
  }

  if (!stepState.approverUserIds.map(String).includes(String(userId))) {
    throw new AppError("NOT_AN_APPROVER");
  }

  if (stepState.decisions.some((d) => String(d.userId) === String(userId))) {
    throw new AppError("WORKFLOW_INVALID_STATE", { message: "You have already responded to this request." });
  }

  const workflow = await Workflow.findById(instance.workflowId).lean();
  const definition = (workflow.steps || []).find((s) => s.order === stepState.order);

  stepState.decisions.push({
    userId,
    userName: (req && req.auth && req.auth.name) || null,
    decision: decision === "approve" ? "approved" : "rejected",
    comment: comment || "",
    decidedAt: new Date(),
  });

  // A rejection ends the whole request immediately, whatever the step mode.
  if (decision !== "approve") {
    if (definition && definition.canReject === false) {
      throw AppError.forbidden("This step does not allow rejection.");
    }
    stepState.status = "rejected";
    stepState.completedAt = new Date();
    await instance.save();
    return complete(instance, "rejected", comment || "", req);
  }

  const needsAll = stepState.mode === "all";
  const approvals = stepState.decisions.filter((d) => d.decision === "approved").length;
  const satisfied = needsAll ? approvals >= stepState.approverUserIds.length : approvals >= 1;

  if (!satisfied) {
    await instance.save();
    return { instance, completed: false };
  }

  stepState.status = "approved";
  stepState.completedAt = new Date();
  await instance.save();

  const employee = await Employee.findById(instance.requesterEmployeeId).lean();
  return advance(instance, workflow, employee, req);
}

async function complete(instance, outcome, reason, req) {
  instance.status = outcome;
  instance.outcome = outcome;
  instance.completedAt = new Date();
  if (outcome === "rejected") instance.rejectionReason = reason;
  await instance.save();

  const handler = completionHandlers.get(instance.entityType);
  if (handler) {
    try {
      await handler(instance, outcome, { reason, req });
    } catch (err) {
      logger.error(
        { err, instance: String(instance._id), entityType: instance.entityType },
        "Workflow completion handler failed"
      );
    }
  }

  await audit.record(
    {
      action: `workflow.${outcome}`,
      entityType: "WorkflowInstance",
      entityId: instance._id,
      entityLabel: instance.entityLabel,
      after: { outcome, reason },
      severity: "notice",
    },
    req
  );

  return { instance, completed: true, outcome };
}

async function cancel(instanceId, reason, req) {
  const instance = await WorkflowInstance.findById(instanceId);
  if (!instance) throw AppError.notFound("Approval");
  if (instance.status !== "pending") return { instance, completed: true, outcome: instance.status };
  return complete(instance, "cancelled", reason, req);
}

/** Everything waiting on this user. */
async function pendingFor(userId, query = {}) {
  const { page, limit, skip } = parseListQuery(query, {
    allowedSort: ["createdAt"],
    defaultSort: "-createdAt",
  });

  const filter = {
    status: "pending",
    steps: { $elemMatch: { status: "pending", approverUserIds: userId } },
  };
  if (query.entityType) filter.entityType = query.entityType;

  const [items, total] = await Promise.all([
    WorkflowInstance.find(filter)
      .populate({
        path: "requesterEmployeeId",
        select: "employeeCode personal.firstName personal.lastName avatarFileId",
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    WorkflowInstance.countDocuments(filter),
  ]);

  return {
    items: items.map((i) => ({
      ...i,
      url: urlFor(i),
      currentStep: (i.steps || []).find((s) => s.order === i.currentStepOrder),
    })),
    page,
    limit,
    total,
  };
}

/**
 * Escalate or auto-approve steps that have sat past their due date.
 * Driven by the scheduler.
 */
async function processOverdue(req) {
  const overdue = await WorkflowInstance.find({
    status: "pending",
    steps: { $elemMatch: { status: "pending", dueAt: { $lt: new Date() } } },
  }).limit(200);

  let escalated = 0;
  let autoApproved = 0;

  for (const instance of overdue) {
    const workflow = await Workflow.findById(instance.workflowId).lean();
    if (!workflow) continue;

    const stepState = instance.steps.find((s) => s.order === instance.currentStepOrder);
    if (!stepState || stepState.status !== "pending") continue;

    const definition = (workflow.steps || []).find((s) => s.order === stepState.order);
    if (!definition) continue;

    const employee = await Employee.findById(instance.requesterEmployeeId).lean();
    if (!employee) continue;

    if (definition.autoApproveAfterDays > 0) {
      stepState.status = "auto_approved";
      stepState.completedAt = new Date();
      stepState.skipReason = `Automatically approved after ${definition.autoApproveAfterDays} days without a decision`;
      await instance.save();
      await advance(instance, workflow, employee, req);
      autoApproved += 1;
    } else if (definition.escalateAfterDays > 0) {
      stepState.status = "escalated";
      stepState.completedAt = new Date();
      stepState.skipReason = `Escalated after ${definition.escalateAfterDays} days without a decision`;
      await instance.save();
      await advance(instance, workflow, employee, req);
      escalated += 1;
    }
  }

  if (escalated || autoApproved) {
    logger.info({ escalated, autoApproved }, "Overdue approvals processed");
  }
  return { escalated, autoApproved, checked: overdue.length };
}

module.exports = {
  onComplete,
  resolveWorkflow,
  resolveApprovers,
  start,
  decide,
  cancel,
  complete,
  pendingFor,
  processOverdue,
  urlFor,
  Workflow,
  WorkflowInstance,
  ApprovalDelegation,
};
