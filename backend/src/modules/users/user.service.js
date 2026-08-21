"use strict";

const User = require("./user.model");
const Membership = require("../rbac/membership.model");
const Role = require("../rbac/role.model");
const Employee = require("../employees/employee.model");
const Organization = require("../organizations/organization.model");
const rbac = require("../rbac/rbac.service");
const notifications = require("../notifications/notification.service");
const { assertLimit } = require("../organizations/planGuard");
const { AppError } = require("../../core/errors/AppError");
const { parseListQuery, searchFilter } = require("../../core/http/queryOptions");
const audit = require("../../core/audit/audit.service");
const tenant = require("../../core/tenancy/tenantContext");
const { env } = require("../../config/env");

/**
 * Users inside one organization.
 *
 * Every read here starts from Membership, never from User. The User collection
 * is global — listing it directly would show one tenant the people who work at
 * another. Memberships are tenant-scoped by the plugin, so starting there
 * makes the isolation structural rather than something each query remembers.
 */

async function list(query) {
  const { page, limit, skip, search } = parseListQuery(query, {
    allowedSort: ["createdAt", "status"],
    defaultSort: "-createdAt",
  });

  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.roleId) filter.roleIds = query.roleId;

  const memberships = await Membership.find(filter)
    .populate("roleIds", "name key isOwner")
    .sort({ createdAt: -1 })
    .lean();

  const users = await User.find({ _id: { $in: memberships.map((m) => m.userId) } }).lean();
  const byId = Object.fromEntries(users.map((u) => [String(u._id), u]));

  const employees = await Employee.find({
    _id: { $in: memberships.map((m) => m.employeeId).filter(Boolean) },
  })
    .select("employeeCode personal.firstName personal.lastName avatarFileId")
    .lean();
  const employeeById = Object.fromEntries(employees.map((e) => [String(e._id), e]));

  let rows = memberships
    .map((m) => {
      const user = byId[String(m.userId)];
      if (!user) return null;
      const employee = m.employeeId ? employeeById[String(m.employeeId)] : null;
      return {
        id: String(user._id),
        membershipId: String(m._id),
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: [user.firstName, user.lastName].filter(Boolean).join(" "),
        phone: user.phone,
        status: m.status,
        userStatus: user.status,
        emailVerified: Boolean(user.emailVerifiedAt),
        lastLoginAt: user.lastLoginAt,
        joinedAt: m.joinedAt,
        invitedAt: m.invitedAt,
        isManager: m.isManager,
        roles: (m.roleIds || []).map((r) => ({ id: String(r._id), name: r.name, key: r.key, isOwner: r.isOwner })),
        employee: employee
          ? {
              id: String(employee._id),
              code: employee.employeeCode,
              name: [employee.personal.firstName, employee.personal.lastName].filter(Boolean).join(" "),
            }
          : null,
      };
    })
    .filter(Boolean);

  // Search happens after the join because the searchable fields live on User.
  if (search) {
    const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    rows = rows.filter((r) => rx.test(r.email) || rx.test(r.fullName));
  }

  const total = rows.length;
  return { items: rows.slice(skip, skip + limit), page, limit, total };
}

async function getById(userId) {
  const membership = await Membership.findOne({ userId })
    .populate("roleIds", "name key isOwner permissions")
    .lean();
  if (!membership) throw AppError.notFound("User");

  const user = await User.findById(userId).lean();
  if (!user) throw AppError.notFound("User");

  return {
    id: String(user._id),
    membershipId: String(membership._id),
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    status: membership.status,
    userStatus: user.status,
    emailVerified: Boolean(user.emailVerifiedAt),
    lastLoginAt: user.lastLoginAt,
    roles: membership.roleIds,
    permissions: membership.permissions,
    employeeId: membership.employeeId ? String(membership.employeeId) : null,
    isManager: membership.isManager,
  };
}

/** Invite someone who is not (or not yet) an employee: an accountant, a consultant. */
async function invite({ email, firstName, lastName, roleIds, employeeId }, req) {
  const organizationId = tenant.requireOrganizationId();
  const organization = await tenant.runAsSystem(
    () => Organization.findById(organizationId).lean(),
    "user.invite"
  );

  const roles = await Role.find({ _id: { $in: roleIds } }).lean();
  if (roles.length !== roleIds.length) {
    throw AppError.badRequest("One or more of the selected roles do not exist.");
  }

  // Administrator seats are a plan limit; ordinary employee logins are not.
  const grantsAdmin = roles.some((r) => (r.permissions || []).includes("settings.manage"));
  if (grantsAdmin) {
    const adminCount = await Membership.countDocuments({
      status: { $in: ["active", "invited"] },
      permissions: "settings.manage",
    });
    assertLimit(organization, "admins", adminCount, 1);
  }

  const existingMembership = await Membership.findOne({ userId: { $exists: true } })
    .where("userId")
    .equals(await userIdForEmail(email))
    .lean()
    .catch(() => null);

  if (existingMembership && existingMembership.status !== "removed") {
    throw AppError.conflict("That person already has access to this organization.");
  }

  let user = await User.findOne({ email });
  const token = User.generateToken();

  if (!user) {
    user = new User({
      email,
      firstName: firstName || email.split("@")[0],
      lastName: lastName || "",
      status: "invited",
    });
  }
  user.invitationTokenHash = token.hash;
  user.invitationExpiresAt = new Date(Date.now() + 7 * 86400000);
  user.lastOrganizationId = user.lastOrganizationId || organizationId;
  await user.save();

  const permissions = await rbac.permissionsForRoles(roleIds);

  const membership = existingMembership
    ? await Membership.findOneAndUpdate(
        { _id: existingMembership._id },
        { $set: { roleIds, permissions, status: "invited", employeeId: employeeId || null } },
        { new: true }
      )
    : await Membership.create({
        organizationId,
        userId: user._id,
        employeeId: employeeId || null,
        roleIds,
        permissions,
        status: "invited",
        invitedBy: tenant.getUserId(),
        invitedAt: new Date(),
      });

  await notifications.sendTransactional({
    to: email,
    template: "user_invitation",
    organizationId,
    data: {
      firstName: user.firstName,
      inviterName: (req && req.auth && req.auth.name) || "Your administrator",
      roleName: roles.map((r) => r.name).join(", "),
      acceptUrl: `${env.app.publicUrl}/accept-invitation?token=${token.plain}`,
      expiresInDays: 7,
      company: { name: organization.name },
    },
  });

  await audit.record(
    {
      action: "user.invited",
      entityType: "User",
      entityId: user._id,
      entityLabel: email,
      after: { email, roles: roles.map((r) => r.name) },
      severity: "warning",
    },
    req
  );

  return { id: String(user._id), membershipId: String(membership._id), email, invited: true };
}

async function userIdForEmail(email) {
  const user = await User.findOne({ email }).select("_id").lean();
  return user ? user._id : null;
}

async function updateMembership(userId, data, req) {
  const membership = await Membership.findOne({ userId });
  if (!membership) throw AppError.notFound("User");

  const before = {
    status: membership.status,
    roleIds: membership.roleIds.map(String),
    isManager: membership.isManager,
    employeeId: membership.employeeId ? String(membership.employeeId) : null,
  };

  if (data.roleIds) {
    await rbac.assignRoles(membership._id, data.roleIds, req);
    // assignRoles saved and re-derived permissions; reload before touching more.
    await membership.populate("roleIds");
  }

  if (data.status !== undefined) {
    if (data.status === "removed" || data.status === "suspended") {
      await assertNotLastOwner(membership);
    }
    membership.status = data.status;
  }
  if (data.isManager !== undefined) membership.isManager = data.isManager;
  if (data.employeeId !== undefined) membership.employeeId = data.employeeId;

  await membership.save();
  rbac.invalidateUser(String(tenant.requireOrganizationId()), String(userId));

  await audit.record(
    {
      action: "user.updated",
      entityType: "Membership",
      entityId: membership._id,
      entityLabel: String(userId),
      before,
      after: {
        status: membership.status,
        roleIds: membership.roleIds.map(String),
        isManager: membership.isManager,
        employeeId: membership.employeeId ? String(membership.employeeId) : null,
      },
      severity: "warning",
      skipIfUnchanged: true,
    },
    req
  );

  return getById(userId);
}

/**
 * An organization with no active owner cannot recover on its own — the last
 * one cannot be suspended, removed, or stripped of the role.
 */
async function assertNotLastOwner(membership) {
  const ownerRole = await Role.findOne({ isOwner: true }).select("_id").lean();
  if (!ownerRole) return;
  const isOwner = membership.roleIds.map(String).includes(String(ownerRole._id));
  if (!isOwner) return;

  const otherOwners = await Membership.countDocuments({
    roleIds: ownerRole._id,
    status: "active",
    _id: { $ne: membership._id },
  });
  if (otherOwners === 0) {
    throw AppError.conflict(
      "This is the only Owner of the organization. Make someone else an Owner first."
    );
  }
}

/** Remove access without deleting the person's login. */
async function removeMembership(userId, req) {
  const membership = await Membership.findOne({ userId });
  if (!membership) throw AppError.notFound("User");

  await assertNotLastOwner(membership);

  membership.status = "removed";
  await membership.save();
  rbac.invalidateUser(String(tenant.requireOrganizationId()), String(userId));

  await audit.record(
    {
      action: "user.removed",
      entityType: "Membership",
      entityId: membership._id,
      entityLabel: String(userId),
      severity: "critical",
      description: "Access to this organization was revoked",
    },
    req
  );

  return { id: String(userId), removed: true };
}

async function resendInvitation(userId, req) {
  const membership = await Membership.findOne({ userId }).populate("roleIds", "name").lean();
  if (!membership) throw AppError.notFound("User");
  if (membership.status !== "invited") {
    throw AppError.badRequest("That person has already accepted their invitation.");
  }

  const user = await User.findById(userId);
  const token = User.generateToken();
  user.invitationTokenHash = token.hash;
  user.invitationExpiresAt = new Date(Date.now() + 7 * 86400000);
  await user.save();

  const organization = await tenant.runAsSystem(
    () => Organization.findById(tenant.requireOrganizationId()).lean(),
    "user.resend-invite"
  );

  await notifications.sendTransactional({
    to: user.email,
    template: "user_invitation",
    organizationId: organization._id,
    data: {
      firstName: user.firstName,
      inviterName: (req && req.auth && req.auth.name) || "Your administrator",
      roleName: (membership.roleIds || []).map((r) => r.name).join(", "),
      acceptUrl: `${env.app.publicUrl}/accept-invitation?token=${token.plain}`,
      expiresInDays: 7,
      company: { name: organization.name },
    },
  });

  return { resent: true, email: user.email };
}

/** The signed-in user editing their own account details. */
async function updateOwnAccount(userId, data, req) {
  const user = await User.findById(userId);
  if (!user) throw new AppError("UNAUTHENTICATED");

  const before = { firstName: user.firstName, lastName: user.lastName, phone: user.phone };

  if (data.firstName !== undefined) user.firstName = data.firstName;
  if (data.lastName !== undefined) user.lastName = data.lastName;
  if (data.phone !== undefined) user.phone = data.phone;
  if (data.locale !== undefined) user.locale = data.locale;
  if (data.timezone !== undefined) user.timezone = data.timezone;
  await user.save();

  await audit.record(
    {
      action: "user.self_updated",
      entityType: "User",
      entityId: user._id,
      entityLabel: user.email,
      before,
      after: { firstName: user.firstName, lastName: user.lastName, phone: user.phone },
      skipIfUnchanged: true,
    },
    req
  );

  return require("../auth/auth.service").publicUser(user);
}

module.exports = {
  list,
  getById,
  invite,
  updateMembership,
  removeMembership,
  resendInvitation,
  updateOwnAccount,
};
