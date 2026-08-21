"use strict";

const { LeaveType, LeavePolicy, LeaveBalance, LeaveRequest, LeaveDay } = require("./leave.model");
const engine = require("./leaveEngine");
const Employee = require("../employees/employee.model");
const Organization = require("../organizations/organization.model");
const employeeService = require("../employees/employee.service");
const shiftService = require("../shifts/shift.service");
const holidayService = require("../holidays/holiday.service");
const attendanceService = require("../attendance/attendance.service");
const notifications = require("../notifications/notification.service");
const settings = require("../../core/settings/settings.service");
const { AppError } = require("../../core/errors/AppError");
const { parseListQuery } = require("../../core/http/queryOptions");
const audit = require("../../core/audit/audit.service");
const tenant = require("../../core/tenancy/tenantContext");
const { logger } = require("../../config/logger");
const dt = require("../../shared/datetime");

/**
 * Leave orchestration.
 *
 * The engine decides how many days a request costs; this file decides whether
 * the request is allowed, moves the balance, writes the day rows, and drives
 * approval. The critical invariant is that a balance is only ever changed
 * through `adjustBalance`, which always appends a history entry — so every
 * number on a balance screen can be traced to the event that produced it.
 */

// ── Leave year ──────────────────────────────────────────────────────────────

async function leaveYearFor(dateString, policy) {
  const startMonth =
    (policy && policy.yearStartMonth) || (await settings.get("leave.year_start_month")) || 1;
  const [year, month] = dateString.split("-").map(Number);
  const startYear = month >= startMonth ? year : year - 1;
  const periodStart = `${startYear}-${String(startMonth).padStart(2, "0")}-01`;
  const periodEnd = dt.addDays(
    `${startYear + 1}-${String(startMonth).padStart(2, "0")}-01`,
    -1
  );
  return { year: startYear, periodStart, periodEnd };
}

async function resolvePolicy(employee) {
  const id = employee.employment && employee.employment.leavePolicyId;
  if (id) {
    const policy = await LeavePolicy.findById(id).lean();
    if (policy) return policy;
  }
  return LeavePolicy.findOne({ isDefault: true, isActive: true }).lean();
}

function ruleFor(policy, leaveTypeId) {
  if (!policy) return null;
  return (policy.rules || []).find((r) => String(r.leaveTypeId) === String(leaveTypeId)) || null;
}

// ── Calendar context ────────────────────────────────────────────────────────

/** Which days in a range are holidays or weekly offs for this employee. */
async function buildCalendar(employee, fromDate, toDate) {
  const [holidayCache, weeklyOffPolicy] = await Promise.all([
    holidayService.buildHolidayCache({ fromDate, toDate }),
    shiftService.resolveWeeklyOffPolicy(employee),
  ]);

  const calendar = {};
  for (const date of dt.eachDate(fromDate, toDate, 400)) {
    const holiday = await holidayService.holidayFor(employee, date, holidayCache);
    const weeklyOff = shiftService.evaluateWeeklyOff(weeklyOffPolicy, date);
    calendar[date] = {
      isHoliday: Boolean(holiday),
      holidayName: holiday ? holiday.name : null,
      isWeeklyOff: weeklyOff.isOff,
      isHalfDayOff: weeklyOff.isHalfDay,
    };
  }
  return calendar;
}

// ── Balances ────────────────────────────────────────────────────────────────

async function getOrCreateBalance(employee, leaveType, dateString, policy) {
  const { year, periodStart, periodEnd } = await leaveYearFor(dateString, policy);

  let balance = await LeaveBalance.findOne({
    employeeId: employee._id,
    leaveTypeId: leaveType._id,
    year,
  });

  if (balance) return balance;

  const rule = ruleFor(policy, leaveType._id);
  const allocation = rule
    ? engine.computeAllocation({
        rule,
        periodStart,
        periodEnd,
        joiningDate: employee.employment && employee.employment.joiningDate,
        exitDate: employee.exit && employee.exit.lastWorkingDay,
      })
    : { days: 0, breakdown: [] };

  // Accrual credits month by month, so the opening allocation is zero and the
  // monthly job tops it up. Anything else is credited up front.
  const isAccrual = rule && rule.allocation && rule.allocation.mode === "accrual";

  balance = await LeaveBalance.create({
    employeeId: employee._id,
    leaveTypeId: leaveType._id,
    year,
    periodStart,
    periodEnd,
    allocated: isAccrual ? 0 : allocation.days,
    history: [
      {
        type: "allocation",
        days: isAccrual ? 0 : allocation.days,
        balanceAfter: isAccrual ? 0 : allocation.days,
        note: isAccrual
          ? `Accrual-based: credited monthly (${(rule.allocation.accrualPerMonth || 0)} per month)`
          : allocation.breakdown.map((b) => b.detail).join("; "),
      },
    ],
  });

  return balance;
}

/**
 * The single mutation point for balances.
 *
 * @param {string} type   allocation | accrual | credit | usage | cancellation | encashment | lapse | adjustment | carry_forward
 * @param {number} days   positive adds availability, negative reduces it
 */
async function adjustBalance(balance, { field, type, days, note, reference }) {
  balance[field] = round2((balance[field] || 0) + days);
  balance.history.push({
    at: new Date(),
    type,
    days,
    balanceAfter: balance.available,
    note: note || "",
    reference: reference || null,
    byUserId: tenant.getUserId(),
  });
  await balance.save();
  return balance;
}

/** Every leave type with the employee's balance and eligibility. */
async function balancesFor(employeeId, dateString) {
  const employee = await Employee.findById(employeeId).lean();
  if (!employee) throw new AppError("EMPLOYEE_NOT_FOUND");

  const policy = await resolvePolicy(employee);
  const asOf = dateString || dt.todayString(await attendanceService.organizationTimezone());
  const types = await LeaveType.find({ isActive: true }).sort({ order: 1, name: 1 }).lean();

  const isProbation = isOnProbation(employee, asOf);
  const isNotice = employee.status === "notice_period";

  const out = [];
  for (const leaveType of types) {
    const rule = ruleFor(policy, leaveType._id);
    const eligibility = engine.checkEligibility({
      employee,
      leaveType,
      asOfDate: asOf,
      isProbation,
      isNoticePeriod: isNotice,
    });

    if (!leaveType.hasBalance) {
      out.push({
        leaveType: shapeType(leaveType),
        hasBalance: false,
        available: null,
        eligible: eligibility.eligible,
        ineligibleReasons: eligibility.reasons,
        rule: rule ? summariseRule(rule) : null,
      });
      continue;
    }

    const balance = await getOrCreateBalance(employee, leaveType, asOf, policy);
    out.push({
      leaveType: shapeType(leaveType),
      hasBalance: true,
      year: balance.year,
      periodStart: balance.periodStart,
      periodEnd: balance.periodEnd,
      opening: balance.opening,
      allocated: balance.allocated,
      carriedForward: balance.carriedForward,
      credited: balance.credited,
      adjustment: balance.adjustment,
      used: balance.used,
      pending: balance.pending,
      encashed: balance.encashed,
      lapsed: balance.lapsed,
      available: balance.available,
      eligible: eligibility.eligible,
      ineligibleReasons: eligibility.reasons,
      rule: rule ? summariseRule(rule) : null,
    });
  }
  return out;
}

function shapeType(leaveType) {
  return {
    id: String(leaveType._id),
    name: leaveType.name,
    code: leaveType.code,
    colour: leaveType.colour,
    isPaid: leaveType.isPaid,
    allowHalfDay: leaveType.allowHalfDay,
    requiresAttachment: leaveType.requiresAttachment,
    attachmentRequiredAfterDays: leaveType.attachmentRequiredAfterDays,
  };
}

function summariseRule(rule) {
  return {
    allocationMode: rule.allocation && rule.allocation.mode,
    daysPerPeriod: rule.allocation && rule.allocation.daysPerPeriod,
    carryForward: rule.carryForward && rule.carryForward.enabled,
    noticeDays: rule.application && rule.application.noticeDays,
    maxPerRequest: rule.application && rule.application.maximumDaysPerRequest,
    countsHolidays: rule.counting && rule.counting.holidays,
    countsWeeklyOffs: rule.counting && rule.counting.weeklyOffs,
  };
}

function isOnProbation(employee, asOf) {
  const joining = employee.employment && employee.employment.joiningDate;
  const confirmation = employee.employment && employee.employment.confirmationDate;
  if (confirmation) return asOf < dt.toDateString(confirmation, "UTC");
  if (!joining) return false;
  const months = employee.employment.probationMonths;
  if (!months) return false;
  const joiningDate = dt.toDateString(joining, "UTC");
  return dt.monthsSince(joiningDate, asOf) < months;
}

// ── Preview ─────────────────────────────────────────────────────────────────

/**
 * Cost a request without applying for it.
 * The apply screen calls this on every date change, so the employee sees
 * "3 days will be deducted, the weekend in between is free" before submitting.
 */
async function preview(employeeId, { leaveTypeId, fromDate, toDate, fromPortion, toPortion }) {
  const employee = await Employee.findById(employeeId).lean();
  if (!employee) throw new AppError("EMPLOYEE_NOT_FOUND");

  const leaveType = await LeaveType.findById(leaveTypeId).lean();
  if (!leaveType) throw AppError.badRequest("That leave type does not exist.");

  const policy = await resolvePolicy(employee);
  const rule = ruleFor(policy, leaveTypeId);
  if (!rule) {
    throw new AppError("LEAVE_NOT_ELIGIBLE", {
      message: `${leaveType.name} is not part of your leave policy.`,
    });
  }

  const calendar = await buildCalendar(employee, fromDate, toDate);
  const computed = engine.computeDays({ fromDate, toDate, fromPortion, toPortion, rule, calendar });

  let available = null;
  if (leaveType.hasBalance) {
    const balance = await getOrCreateBalance(employee, leaveType, fromDate, policy);
    available = balance.available;
  }

  const today = dt.todayString(await attendanceService.organizationTimezone());
  const { year } = await leaveYearFor(fromDate, policy);
  const requestsThisYear = await LeaveRequest.countDocuments({
    employeeId,
    leaveTypeId,
    status: { $in: ["pending", "approved"] },
    fromDate: { $gte: `${year}-01-01` },
  });

  const problems = engine.checkApplicationRules({
    rule,
    leaveDays: computed.leaveDays,
    fromDate,
    today,
    balanceAvailable: available === null ? Number.MAX_SAFE_INTEGER : available,
    requestsThisYear,
  });

  const eligibility = engine.checkEligibility({
    employee,
    leaveType,
    asOfDate: fromDate,
    isProbation: isOnProbation(employee, fromDate),
    isNoticePeriod: employee.status === "notice_period",
  });

  return {
    leaveType: shapeType(leaveType),
    calendarDays: computed.calendarDays,
    leaveDays: computed.leaveDays,
    days: computed.days,
    breakdown: computed.breakdown,
    balanceAvailable: available,
    balanceAfter: available === null ? null : round2(available - computed.leaveDays),
    canApply: problems.length === 0 && eligibility.eligible,
    problems: [...eligibility.reasons, ...problems],
    attachmentRequired:
      leaveType.requiresAttachment ||
      (leaveType.attachmentRequiredAfterDays > 0 &&
        computed.leaveDays > leaveType.attachmentRequiredAfterDays),
  };
}

// ── Apply ───────────────────────────────────────────────────────────────────

async function apply(employeeId, data, req, { onBehalf = false } = {}) {
  const employee = await Employee.findById(employeeId).lean();
  if (!employee) throw new AppError("EMPLOYEE_NOT_FOUND");

  const leaveType = await LeaveType.findById(data.leaveTypeId).lean();
  if (!leaveType) throw AppError.badRequest("That leave type does not exist.");

  if (data.fromDate > data.toDate) {
    throw AppError.badRequest("The start date must be on or before the end date.");
  }

  const policy = await resolvePolicy(employee);
  const rule = ruleFor(policy, data.leaveTypeId);
  if (!rule) {
    throw new AppError("LEAVE_NOT_ELIGIBLE", {
      message: `${leaveType.name} is not part of this employee's leave policy.`,
    });
  }

  // Overlap check first: it is the cheapest way to reject a re-submission.
  const overlapping = await LeaveDay.findOne({
    employeeId,
    date: { $gte: data.fromDate, $lte: data.toDate },
    status: { $in: ["pending", "approved"] },
  }).lean();
  if (overlapping) {
    throw new AppError("LEAVE_OVERLAP", {
      message: `There is already a leave request covering ${overlapping.date}.`,
    });
  }

  const check = await preview(employeeId, data);
  if (!check.canApply && !onBehalf) {
    throw new AppError("LEAVE_NOT_ELIGIBLE", {
      message: check.problems[0],
      details: { problems: check.problems },
    });
  }
  // HR applying on behalf can override the soft rules, but never eligibility.
  if (onBehalf && check.problems.length) {
    const eligibilityBlock = check.problems.find((p) => p.includes("not available"));
    if (eligibilityBlock) {
      throw new AppError("LEAVE_NOT_ELIGIBLE", { message: eligibilityBlock });
    }
  }

  if (check.attachmentRequired && !data.attachmentFileId) {
    throw AppError.validation([
      { field: "attachmentFileId", message: `${leaveType.name} of this length needs a supporting document` },
    ]);
  }

  const autoApprove = rule.approval && (rule.approval.autoApprove || !rule.approval.required);

  const request = await LeaveRequest.create({
    employeeId,
    leaveTypeId: data.leaveTypeId,
    fromDate: data.fromDate,
    toDate: data.toDate,
    fromPortion: data.fromPortion || "full",
    toPortion: data.toPortion || "full",
    calendarDays: check.calendarDays,
    leaveDays: check.leaveDays,
    reason: data.reason,
    contactDuringLeave: data.contactDuringLeave || "",
    handoverToEmployeeId: data.handoverToEmployeeId || null,
    attachmentFileId: data.attachmentFileId || null,
    status: autoApprove ? "approved" : "pending",
    appliedBy: tenant.getUserId(),
    appliedOnBehalf: onBehalf,
    calculation: { breakdown: check.breakdown, rule: summariseRule(rule) },
  });

  // Explode into day rows.
  await LeaveDay.insertMany(
    check.days.map((day) => ({
      organizationId: tenant.requireOrganizationId(),
      employeeId,
      leaveRequestId: request._id,
      leaveTypeId: data.leaveTypeId,
      date: day.date,
      dayPortion: day.portion,
      deductedDays: day.deductedDays,
      status: autoApprove ? "approved" : "pending",
      isNonWorkingDay: day.isNonWorking,
      nonWorkingReason: day.reason,
    }))
  );

  // Reserve the balance immediately. A pending request that has not moved the
  // balance lets an employee apply for the same days twice over.
  if (leaveType.hasBalance) {
    const balance = await getOrCreateBalance(employee, leaveType, data.fromDate, policy);
    await adjustBalance(balance, {
      field: autoApprove ? "used" : "pending",
      type: "usage",
      days: check.leaveDays,
      note: `${autoApprove ? "Approved" : "Applied"}: ${data.fromDate} to ${data.toDate}`,
      reference: String(request._id),
    });
  }

  if (autoApprove) {
    await onApproved(request, employee, req);
  } else {
    await notifyApprovers(request, employee, leaveType);
  }

  await audit.record(
    {
      action: "leave.applied",
      entityType: "LeaveRequest",
      entityId: request._id,
      entityLabel: `${employee.employeeCode} — ${leaveType.name} ${data.fromDate} to ${data.toDate}`,
      after: {
        leaveType: leaveType.name,
        fromDate: data.fromDate,
        toDate: data.toDate,
        days: check.leaveDays,
        onBehalf,
      },
      severity: "notice",
    },
    req
  );

  return request;
}

async function notifyApprovers(request, employee, leaveType) {
  const managerId = employee.employment && employee.employment.managerId;
  const approvers = [];

  if (managerId) {
    const manager = await Employee.findById(managerId).select("userId personal").lean();
    if (manager && manager.userId) {
      approvers.push({
        userId: manager.userId,
        employeeId: manager._id,
        email: manager.personal.workEmail,
        firstName: manager.personal.firstName,
      });
    }
  }

  if (!approvers.length) {
    // Nobody in the reporting line: fall back to whoever can approve leave.
    const Membership = require("../rbac/membership.model");
    const User = require("../users/user.model");
    const memberships = await Membership.find({ permissions: "leave.approve", status: "active" })
      .select("userId")
      .limit(5)
      .lean();
    const users = await User.find({ _id: { $in: memberships.map((m) => m.userId) } }).lean();
    approvers.push(
      ...users.map((u) => ({ userId: u._id, email: u.email, firstName: u.firstName }))
    );
  }

  if (!approvers.length) return;

  const organization = await tenant.runAsSystem(
    () => Organization.findById(tenant.requireOrganizationId()).lean(),
    "leave.notify"
  );

  await notifications.notify({
    template: "leave_applied",
    recipients: approvers,
    organization,
    data: {
      employee: {
        name: [employee.personal.firstName, employee.personal.lastName].filter(Boolean).join(" "),
        firstName: employee.personal.firstName,
      },
      leave: {
        id: String(request._id),
        type: leaveType.name,
        from: request.fromDate,
        to: request.toDate,
        days: request.leaveDays,
        reason: request.reason,
      },
    },
    entity: { type: "LeaveRequest", id: request._id },
  });
}

// ── Decide ──────────────────────────────────────────────────────────────────

async function decide(requestId, { decision, comment }, req) {
  const request = await LeaveRequest.findById(requestId);
  if (!request) throw AppError.notFound("Leave request");

  if (request.status !== "pending") {
    throw new AppError("WORKFLOW_INVALID_STATE", {
      message: `This request has already been ${request.status}.`,
    });
  }

  const employee = await Employee.findById(request.employeeId).lean();
  const leaveType = await LeaveType.findById(request.leaveTypeId).lean();
  const policy = await resolvePolicy(employee);

  request.status = decision === "approve" ? "approved" : "rejected";
  request.approvals.push({
    level: 1,
    approverUserId: tenant.getUserId(),
    approverName: (req && req.auth && req.auth.name) || null,
    decision: decision === "approve" ? "approved" : "rejected",
    comment: comment || "",
    decidedAt: new Date(),
  });
  if (decision !== "approve") request.rejectionReason = comment || "";
  await request.save();

  await LeaveDay.updateMany(
    { leaveRequestId: request._id },
    { $set: { status: request.status } }
  );

  // Move the reservation: pending → used on approval, released on rejection.
  if (leaveType.hasBalance) {
    const balance = await getOrCreateBalance(employee, leaveType, request.fromDate, policy);
    if (decision === "approve") {
      balance.pending = round2(balance.pending - request.leaveDays);
      await adjustBalance(balance, {
        field: "used",
        type: "usage",
        days: request.leaveDays,
        note: `Approved: ${request.fromDate} to ${request.toDate}`,
        reference: String(request._id),
      });
    } else {
      await adjustBalance(balance, {
        field: "pending",
        type: "cancellation",
        days: -request.leaveDays,
        note: `Rejected: ${request.fromDate} to ${request.toDate}`,
        reference: String(request._id),
      });
    }
  }

  if (decision === "approve") {
    await onApproved(request, employee, req);
  }

  await notifyEmployee(request, employee, leaveType, decision === "approve" ? "leave_approved" : "leave_rejected", req);

  await audit.record(
    {
      action: `leave.${request.status}`,
      entityType: "LeaveRequest",
      entityId: request._id,
      entityLabel: `${employee.employeeCode} — ${leaveType.name} ${request.fromDate} to ${request.toDate}`,
      after: { status: request.status, comment, days: request.leaveDays },
      severity: "notice",
    },
    req
  );

  return request;
}

/**
 * Approved leave changes what those days mean for attendance, so the days are
 * reprocessed. Without this an approved leave still shows as an absence.
 */
async function onApproved(request, employee, req) {
  try {
    await attendanceService.processRange(
      {
        employeeIds: [request.employeeId],
        fromDate: request.fromDate,
        toDate: request.toDate,
        force: false,
      },
      req
    );
  } catch (err) {
    logger.error(
      { err, requestId: String(request._id) },
      "Could not reprocess attendance after leave approval"
    );
  }
}

async function notifyEmployee(request, employee, leaveType, template, req) {
  if (!employee.userId) return;
  const organization = await tenant.runAsSystem(
    () => Organization.findById(tenant.requireOrganizationId()).lean(),
    "leave.notify-employee"
  );

  await notifications
    .notify({
      template,
      recipients: [
        {
          userId: employee.userId,
          employeeId: employee._id,
          email: employee.personal.workEmail,
          firstName: employee.personal.firstName,
        },
      ],
      organization,
      data: {
        employee: {
          firstName: employee.personal.firstName,
          name: [employee.personal.firstName, employee.personal.lastName].filter(Boolean).join(" "),
        },
        leave: {
          id: String(request._id),
          type: leaveType.name,
          from: request.fromDate,
          to: request.toDate,
          rejectionReason: request.rejectionReason,
        },
        approver: { name: (req && req.auth && req.auth.name) || "Your approver" },
      },
      entity: { type: "LeaveRequest", id: request._id },
    })
    .catch((err) => logger.warn({ err }, "Leave notification failed"));
}

async function cancel(requestId, { reason }, req, auth) {
  const request = await LeaveRequest.findById(requestId);
  if (!request) throw AppError.notFound("Leave request");

  if (!["pending", "approved"].includes(request.status)) {
    throw new AppError("WORKFLOW_INVALID_STATE", {
      message: `A ${request.status} request cannot be cancelled.`,
    });
  }

  const isOwn = auth && String(auth.employeeId || "") === String(request.employeeId);
  const canCancelAny = auth && (auth.permissions || []).includes("leave.cancel_any");
  if (!isOwn && !canCancelAny) {
    throw AppError.forbidden("You can only cancel your own leave requests.");
  }

  const today = dt.todayString(await attendanceService.organizationTimezone());
  if (isOwn && !canCancelAny && request.status === "approved" && request.fromDate < today) {
    throw AppError.conflict(
      "Leave that has already started cannot be cancelled from self-service. Ask HR."
    );
  }

  const employee = await Employee.findById(request.employeeId).lean();
  const leaveType = await LeaveType.findById(request.leaveTypeId).lean();
  const policy = await resolvePolicy(employee);

  const wasApproved = request.status === "approved";
  request.status = "cancelled";
  request.cancellationReason = reason || "";
  request.cancelledAt = new Date();
  await request.save();

  await LeaveDay.updateMany({ leaveRequestId: request._id }, { $set: { status: "cancelled" } });

  if (leaveType.hasBalance) {
    const balance = await getOrCreateBalance(employee, leaveType, request.fromDate, policy);
    await adjustBalance(balance, {
      field: wasApproved ? "used" : "pending",
      type: "cancellation",
      days: -request.leaveDays,
      note: `Cancelled: ${request.fromDate} to ${request.toDate}`,
      reference: String(request._id),
    });
  }

  if (wasApproved) await onApproved(request, employee, req);

  await audit.record(
    {
      action: "leave.cancelled",
      entityType: "LeaveRequest",
      entityId: request._id,
      entityLabel: `${employee.employeeCode} — ${leaveType.name}`,
      after: { reason, daysReturned: request.leaveDays },
      severity: "notice",
    },
    req
  );

  return request;
}

/** Manual balance correction by HR. Always audited, always in the history. */
async function adjustEmployeeBalance(employeeId, { leaveTypeId, days, note, year }, req) {
  const employee = await Employee.findById(employeeId).lean();
  if (!employee) throw new AppError("EMPLOYEE_NOT_FOUND");

  const leaveType = await LeaveType.findById(leaveTypeId).lean();
  if (!leaveType) throw AppError.badRequest("That leave type does not exist.");

  const policy = await resolvePolicy(employee);
  const asOf = year
    ? `${year}-06-15`
    : dt.todayString(await attendanceService.organizationTimezone());
  const balance = await getOrCreateBalance(employee, leaveType, asOf, policy);

  const before = balance.available;
  await adjustBalance(balance, {
    field: "adjustment",
    type: "adjustment",
    days,
    note: note || "Manual adjustment",
  });

  await audit.record(
    {
      action: "leave.balance_adjusted",
      entityType: "LeaveBalance",
      entityId: balance._id,
      entityLabel: `${employee.employeeCode} — ${leaveType.name}`,
      before: { available: before },
      after: { available: balance.available, days, note },
      // Someone hand-editing a leave balance is exactly what an auditor looks
      // for, so this is deliberately louder than a normal update.
      severity: "warning",
    },
    req
  );

  return balance;
}

/** Credit comp off earned by working on a day off. */
async function creditCompOff(employeeId, days, { date, note }, req) {
  const employee = await Employee.findById(employeeId).lean();
  const leaveType = await LeaveType.findOne({ isCompOff: true, isActive: true }).lean();
  if (!leaveType) return null; // the organization does not run comp off

  const policy = await resolvePolicy(employee);
  const balance = await getOrCreateBalance(employee, leaveType, date, policy);

  await adjustBalance(balance, {
    field: "credited",
    type: "credit",
    days,
    note: note || `Comp off earned for working on ${date}`,
    reference: date,
  });

  await audit.record(
    {
      action: "leave.comp_off_credited",
      entityType: "LeaveBalance",
      entityId: balance._id,
      entityLabel: `${employee.employeeCode} — ${days} day(s)`,
      after: { days, date },
    },
    req
  );

  return balance;
}

// ── Reads ───────────────────────────────────────────────────────────────────

async function listRequests(query, auth) {
  const { page, limit, skip, sort } = parseListQuery(query, {
    allowedSort: ["fromDate", "createdAt", "status"],
    defaultSort: "-createdAt",
  });

  const scope = employeeService.scopeFilter(auth);
  const employeeFilter = { ...scope.filter };
  if (query.departmentId) employeeFilter["employment.departmentId"] = query.departmentId;
  const employees = await Employee.find(employeeFilter).select("_id").lean();

  const filter = { employeeId: { $in: employees.map((e) => e._id) } };
  if (query.employeeId) filter.employeeId = query.employeeId;
  if (query.status) filter.status = query.status;
  if (query.leaveTypeId) filter.leaveTypeId = query.leaveTypeId;
  if (query.fromDate) filter.toDate = { $gte: query.fromDate };
  if (query.toDate) filter.fromDate = { ...(filter.fromDate || {}), $lte: query.toDate };

  const [items, total] = await Promise.all([
    LeaveRequest.find(filter)
      .populate([
        { path: "employeeId", select: "employeeCode personal.firstName personal.lastName avatarFileId" },
        { path: "leaveTypeId", select: "name code colour isPaid" },
      ])
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    LeaveRequest.countDocuments(filter),
  ]);

  return { items, page, limit, total };
}

/** Who is off, and when — the team leave calendar. */
async function calendar({ fromDate, toDate, departmentId }, auth) {
  const scope = employeeService.scopeFilter(auth);
  const employeeFilter = { ...scope.filter, status: { $in: ["active", "on_leave", "notice_period"] } };
  if (departmentId) employeeFilter["employment.departmentId"] = departmentId;

  const employees = await Employee.find(employeeFilter)
    .select("employeeCode personal.firstName personal.lastName employment.departmentId")
    .lean();

  const days = await LeaveDay.find({
    employeeId: { $in: employees.map((e) => e._id) },
    date: { $gte: fromDate, $lte: toDate },
    status: { $in: ["approved", "pending"] },
    deductedDays: { $gt: 0 },
  })
    .populate({ path: "leaveTypeId", select: "name code colour" })
    .lean();

  const byEmployee = Object.fromEntries(employees.map((e) => [String(e._id), e]));
  const byDate = {};

  for (const day of days) {
    const employee = byEmployee[String(day.employeeId)];
    if (!employee) continue;
    (byDate[day.date] = byDate[day.date] || []).push({
      employeeId: String(day.employeeId),
      employeeCode: employee.employeeCode,
      name: [employee.personal.firstName, employee.personal.lastName].filter(Boolean).join(" "),
      leaveType: day.leaveTypeId ? day.leaveTypeId.name : "Leave",
      colour: day.leaveTypeId ? day.leaveTypeId.colour : "#6366F1",
      portion: day.dayPortion,
      status: day.status,
    });
  }

  return { fromDate, toDate, byDate, totalOnLeave: days.length };
}

async function getRequest(requestId, auth) {
  const request = await LeaveRequest.findById(requestId)
    .populate([
      { path: "employeeId", select: "employeeCode personal employment.departmentId" },
      { path: "leaveTypeId", select: "name code colour isPaid" },
      { path: "handoverToEmployeeId", select: "employeeCode personal.firstName personal.lastName" },
    ])
    .lean();
  if (!request) throw AppError.notFound("Leave request");

  await employeeService.assertCanView(auth, request.employeeId._id || request.employeeId);

  const days = await LeaveDay.find({ leaveRequestId: requestId }).sort({ date: 1 }).lean();
  return { ...request, days };
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

module.exports = {
  leaveYearFor,
  resolvePolicy,
  ruleFor,
  buildCalendar,
  getOrCreateBalance,
  adjustBalance,
  balancesFor,
  preview,
  apply,
  decide,
  cancel,
  adjustEmployeeBalance,
  creditCompOff,
  listRequests,
  getRequest,
  calendar,
  isOnProbation,
  LeaveType,
  LeavePolicy,
  LeaveBalance,
  LeaveRequest,
  LeaveDay,
};
