"use strict";

const tenant = require("../../core/tenancy/tenantContext");

/**
 * Turning people into the recipient shape `notify()` expects.
 *
 * Every module that raises a notification used to write its own version of
 * "find the users who hold this permission" and "turn this employee into a
 * recipient". Five copies drifted five ways; this is the one copy.
 *
 * The shape is { userId, employeeId, email, firstName }. A recipient with no
 * userId can only be emailed; one with no email can only be told in-app.
 */

function employeeToRecipient(employee) {
  if (!employee) return null;
  const personal = employee.personal || {};
  return {
    userId: employee.userId || null,
    employeeId: employee._id,
    email: personal.workEmail || personal.personalEmail || null,
    firstName: personal.firstName || "",
    name: [personal.firstName, personal.lastName].filter(Boolean).join(" "),
  };
}

function userToRecipient(user) {
  if (!user) return null;
  return {
    userId: user._id,
    employeeId: null,
    email: user.email,
    firstName: user.firstName || "",
    name: [user.firstName, user.lastName].filter(Boolean).join(" "),
  };
}

/** Everyone in the current organization holding a permission. */
async function usersWithPermission(permission, { limit = 50 } = {}) {
  const Membership = require("../rbac/membership.model");
  const User = require("../users/user.model");

  const permissions = Array.isArray(permission) ? permission : [permission];
  const memberships = await Membership.find({
    status: "active",
    permissions: { $in: permissions },
  })
    .select("userId employeeId")
    .limit(limit)
    .lean();
  if (!memberships.length) return [];

  const users = await User.find({ _id: { $in: memberships.map((m) => m.userId) }, status: "active" })
    .select("email firstName lastName")
    .lean();
  const employeeByUser = Object.fromEntries(memberships.map((m) => [String(m.userId), m.employeeId]));

  return users.map((u) => ({ ...userToRecipient(u), employeeId: employeeByUser[String(u._id)] || null }));
}

/** The reporting manager of an employee, as a recipient, or null. */
async function managerOf(employee) {
  const managerId = employee && employee.employment && employee.employment.managerId;
  if (!managerId) return null;
  const Employee = require("../employees/employee.model");
  const manager = await Employee.findById(managerId)
    .select("userId personal.firstName personal.lastName personal.workEmail")
    .lean();
  return employeeToRecipient(manager);
}

/** Employees by id, as recipients. */
async function employees(ids) {
  if (!ids || !ids.length) return [];
  const Employee = require("../employees/employee.model");
  const rows = await Employee.find({ _id: { $in: ids } })
    .select("userId personal.firstName personal.lastName personal.workEmail")
    .lean();
  return rows.map(employeeToRecipient).filter(Boolean);
}

/** The current organization, loaded once for branding in emails. */
async function organization() {
  const Organization = require("../organizations/organization.model");
  return tenant.runAsSystem(
    () => Organization.findById(tenant.requireOrganizationId()).lean(),
    "notifications.organization"
  );
}

module.exports = { employeeToRecipient, userToRecipient, usersWithPermission, managerOf, employees, organization };
