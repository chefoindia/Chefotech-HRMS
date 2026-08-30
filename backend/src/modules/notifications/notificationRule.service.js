"use strict";

const NotificationRule = require("./notificationRule.model");
const formula = require("../../core/rules/formula");
const { logger } = require("../../config/logger");

/**
 * Turning a tenant's rules into an actual list of people.
 *
 * Kept apart from notification.service so the resolution can be tested without
 * sending anything, and so the send path stays readable — `notify()` already
 * does rendering, three channels and delivery bookkeeping.
 *
 * Two properties this has to hold, because both failures are silent:
 *
 *   A rule must never REMOVE anyone. The caller's own recipients are the
 *   people the product decided need to know; rules only add. A misconfigured
 *   rule that stopped an employee hearing their leave was approved would look
 *   like the notification system was broken, not like a rule was wrong.
 *
 *   A broken rule must not take down the event. A condition that will not
 *   parse, a role that was deleted, a resolver that throws — each is logged
 *   and skipped, and the notification still goes to everyone else. The
 *   alternative is one bad rule silently suppressing payslip emails for a
 *   whole company.
 */

/** Everyone a rule points at, as the recipient shape `notify()` expects. */
async function resolveRecipients(rule, context) {
  const out = [];

  for (const spec of rule.recipients || []) {
    try {
      const resolved = await resolveOne(spec, context);
      out.push(...resolved);
    } catch (err) {
      logger.warn(
        { rule: String(rule._id), recipientType: spec.type, err: err.message },
        "Notification rule: a recipient could not be resolved and was skipped"
      );
    }
  }

  return out;
}

async function resolveOne(spec, context) {
  const { subject, actor } = context;

  switch (spec.type) {
    case "subject":
      return subject ? [subject] : [];

    case "actor":
      return actor ? [actor] : [];

    case "reporting_manager": {
      if (!subject || !subject.employeeId) return [];
      const Employee = require("../employees/employee.model");
      const employee = await Employee.findById(subject.employeeId)
        .select("employment.managerId")
        .lean();
      const managerId = employee && employee.employment && employee.employment.managerId;
      if (!managerId) return [];
      return employeesToRecipients(await loadEmployees([managerId]));
    }

    case "department_head": {
      if (!subject || !subject.employeeId) return [];
      const Employee = require("../employees/employee.model");
      const employee = await Employee.findById(subject.employeeId)
        .select("employment.departmentId")
        .lean();
      const departmentId = employee && employee.employment && employee.employment.departmentId;
      if (!departmentId) return [];

      const Department = require("../departments/department.model");
      const department = await Department.findById(departmentId).select("headEmployeeId").lean();
      if (!department || !department.headEmployeeId) return [];
      return employeesToRecipients(await loadEmployees([department.headEmployeeId]));
    }

    case "role": {
      if (!spec.roleIds || !spec.roleIds.length) return [];
      const User = require("../users/user.model");
      // Membership carries the roles, so the query is on the join rather than
      // on the user document.
      const Membership = require("../rbac/membership.model");
      const memberships = await Membership.find({ roleIds: { $in: spec.roleIds } })
        .select("userId")
        .lean();
      const userIds = memberships.map((m) => m.userId);
      if (!userIds.length) return [];
      const users = await User.find({ _id: { $in: userIds } })
        .select("email firstName")
        .lean();
      return users.map(userToRecipient);
    }

    case "user": {
      if (!spec.userIds || !spec.userIds.length) return [];
      const User = require("../users/user.model");
      const users = await User.find({ _id: { $in: spec.userIds } })
        .select("email firstName")
        .lean();
      return users.map(userToRecipient);
    }

    case "employee":
      if (!spec.employeeIds || !spec.employeeIds.length) return [];
      return employeesToRecipients(await loadEmployees(spec.employeeIds));

    case "email":
      // No userId, so this one gets email only — there is no in-app inbox to
      // write to for an address that does not belong to a platform user.
      return spec.email ? [{ email: spec.email, firstName: "", userId: null }] : [];

    default:
      return [];
  }
}

async function loadEmployees(ids) {
  const Employee = require("../employees/employee.model");
  return Employee.find({ _id: { $in: ids } })
    .select("userId personal.firstName personal.workEmail")
    .lean();
}

function employeesToRecipients(employees) {
  return employees
    .filter((e) => e && (e.userId || (e.personal && e.personal.workEmail)))
    .map((e) => ({
      userId: e.userId || null,
      employeeId: e._id,
      email: e.personal && e.personal.workEmail,
      firstName: (e.personal && e.personal.firstName) || "",
    }));
}

function userToRecipient(user) {
  return {
    userId: user._id,
    employeeId: null,
    email: user.email,
    firstName: user.firstName || "",
  };
}

/**
 * Whether a rule's condition holds for this event.
 *
 * A condition that cannot be evaluated returns TRUE. That is the safer
 * direction: an administrator who wrote a typo gets one extra email, whereas
 * defaulting to false would silently stop a rule they believe is running —
 * and they would only find out when somebody was not told something.
 */
function conditionHolds(rule, data) {
  if (!rule.condition) return true;
  try {
    // evaluate() returns { value, used }, not a bare value. Reading the
    // object itself is always truthy, which made every condition pass and the
    // whole feature inert — a rule gated on "days >= 5" fired on a one-day
    // absence and nothing looked wrong.
    const result = formula.evaluate(rule.condition, data || {});
    const value = result && typeof result === "object" && "value" in result ? result.value : result;
    return Boolean(value);
  } catch (err) {
    logger.warn(
      { rule: String(rule._id), condition: rule.condition, err: err.message },
      "Notification rule: condition could not be evaluated; treating it as met"
    );
    return true;
  }
}

/**
 * Every extra recipient the tenant's rules ask for on this event.
 *
 * Returns the additions only. The caller unions them with the recipients the
 * product itself chose, which is what keeps rules strictly additive.
 */
async function extraRecipientsFor(event, context = {}) {
  if (!event) return { recipients: [], channels: null, templateKey: null };

  let rules;
  try {
    rules = await NotificationRule.find({ event, isActive: true }).lean();
  } catch (err) {
    // A notification is not worth failing the operation that raised it.
    logger.error({ event, err: err.message }, "Notification rules could not be read");
    return { recipients: [], channels: null, templateKey: null };
  }

  if (!rules.length) return { recipients: [], channels: null, templateKey: null };

  const recipients = [];
  const channels = new Set();
  let templateKey = null;

  for (const rule of rules) {
    if (!conditionHolds(rule, context.data)) continue;

    recipients.push(...(await resolveRecipients(rule, context)));
    for (const channel of rule.channels || []) channels.add(channel);
    // First matching rule that names a template wins; later ones only add
    // audience. Two rules disagreeing about the wording has no sensible
    // answer, and picking the first is at least stable.
    if (!templateKey && rule.templateKey) templateKey = rule.templateKey;
  }

  return {
    recipients,
    channels: channels.size ? [...channels] : null,
    templateKey,
  };
}

/**
 * Merge two recipient lists without telling anyone twice.
 *
 * Deduplicated by userId where there is one and by email otherwise, so the
 * same person reached as "the subject" and as "everyone with the HR Admin
 * role" still gets a single message.
 */
function mergeRecipients(primary = [], extra = []) {
  const seen = new Set();
  const out = [];

  for (const recipient of [...primary, ...extra]) {
    if (!recipient) continue;
    const key = recipient.userId
      ? `u:${String(recipient.userId)}`
      : recipient.email
        ? `e:${String(recipient.email).toLowerCase()}`
        : null;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(recipient);
  }

  return out;
}

module.exports = {
  extraRecipientsFor,
  mergeRecipients,
  resolveRecipients,
  conditionHolds,
};
