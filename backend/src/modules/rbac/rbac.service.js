"use strict";

const Role = require("./role.model");
const Membership = require("./membership.model");
const { systemRoleDefinitions } = require("../../core/rbac/systemRoles");
const { ALL_PERMISSIONS, expandPermissions, isValidPermission } = require("../../core/rbac/permissions");
const { AppError } = require("../../core/errors/AppError");
const tenant = require("../../core/tenancy/tenantContext");
const audit = require("../../core/audit/audit.service");
const { jsonTransform } = require("../../core/tenancy/baseSchema");

/**
 * Role and membership management.
 *
 * The invariant this file protects: `membership.permissions` is always the
 * exact union of the permissions on its roles. Every path that can change a
 * role's permissions or a member's roles ends in recompute().
 */

const CACHE_TTL_MS = 30_000;
const permissionCache = new Map(); // `${orgId}:${userId}` -> { entry, expiresAt }

function cacheKey(organizationId, userId) {
  return `${organizationId}:${userId}`;
}

function invalidateUser(organizationId, userId) {
  permissionCache.delete(cacheKey(organizationId, userId));
}

function invalidateOrganization(organizationId) {
  const prefix = `${organizationId}:`;
  for (const key of permissionCache.keys()) {
    if (key.startsWith(prefix)) permissionCache.delete(key);
  }
}

/** Seed the system roles into a brand-new organization. */
async function seedRoles(organizationId) {
  const definitions = systemRoleDefinitions();
  const existing = await Role.find({}).select("key").lean();
  const have = new Set(existing.map((r) => r.key));

  const toCreate = definitions
    .filter((d) => !have.has(d.key))
    .map((d) => ({
      organizationId,
      key: d.key,
      name: d.name,
      description: d.description,
      permissions: d.permissions,
      isOwner: Boolean(d.isOwner),
      isSystem: true,
      isDefault: Boolean(d.isDefault),
      rank: d.rank,
    }));

  if (toCreate.length) await Role.insertMany(toCreate);
  return Role.find({}).sort({ rank: 1 }).lean();
}

async function listRoles() {
  // `.lean()` skips the schema's own `_id` -> `id` transform (that only runs
  // on a real Mongoose document's toJSON), so it's applied here by hand —
  // the same class of bug already found and fixed in crudFactory.js's list
  // endpoint and the document-templates module. Without it, every role in
  // the list has the same `id: undefined`, which is exactly why clicking one
  // role in a checkbox list (`checked={roleIds.includes(role.id)}`) makes
  // every role in that list appear checked at once.
  const roles = await Role.find({}).sort({ rank: 1, name: 1 }).lean();
  return roles.map((r) => jsonTransform(null, r));
}

async function getRole(roleId) {
  const role = await Role.findById(roleId);
  if (!role) throw AppError.notFound("Role");
  return role;
}

async function createRole(data, req) {
  const permissions = expandPermissions(data.permissions || []);
  const invalid = (data.permissions || []).filter(
    (p) => !p.includes("*") && !isValidPermission(p)
  );
  if (invalid.length) {
    throw AppError.validation(
      invalid.map((p) => ({ field: "permissions", message: `Unknown permission '${p}'` }))
    );
  }

  const role = await Role.create({
    key: data.key || data.name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 40),
    name: data.name,
    description: data.description || "",
    permissions,
    rank: data.rank || 60,
    isSystem: false,
  });

  await audit.record(
    {
      action: "role.created",
      entityType: "Role",
      entityId: role._id,
      entityLabel: role.name,
      after: { name: role.name, permissions: role.permissions },
      severity: "notice",
    },
    req
  );

  return role;
}

async function updateRole(roleId, data, req) {
  const role = await getRole(roleId);
  const before = { name: role.name, permissions: [...role.permissions] };

  if (data.name !== undefined) role.name = data.name;
  if (data.description !== undefined) role.description = data.description;

  if (data.permissions !== undefined) {
    if (role.isOwner) {
      // Reducing the owner role is how a tenant accidentally locks itself out.
      throw AppError.forbidden(
        "The Owner role always has full access and its permissions cannot be changed."
      );
    }
    role.permissions = expandPermissions(data.permissions);
  }

  await role.save();

  // Every member of this role now has a stale permission set.
  await recomputeRoleMembers(roleId);
  invalidateOrganization(tenant.requireOrganizationId());

  await audit.record(
    {
      action: "role.updated",
      entityType: "Role",
      entityId: role._id,
      entityLabel: role.name,
      before,
      after: { name: role.name, permissions: role.permissions },
      severity: "warning",
      skipIfUnchanged: true,
    },
    req
  );

  return role;
}

async function deleteRole(roleId, req) {
  const role = await getRole(roleId);
  if (role.isSystem) throw AppError.forbidden("Built-in roles cannot be deleted.");

  const inUse = await Membership.countDocuments({ roleIds: roleId, status: { $ne: "removed" } });
  if (inUse > 0) {
    throw AppError.conflict(
      `This role is assigned to ${inUse} ${inUse === 1 ? "person" : "people"}. Reassign them first.`
    );
  }

  await role.softDelete(tenant.getUserId());
  await audit.record(
    {
      action: "role.deleted",
      entityType: "Role",
      entityId: role._id,
      entityLabel: role.name,
      severity: "warning",
    },
    req
  );
  return { id: String(role._id) };
}

/** Union the permissions of the given roles. */
async function permissionsForRoles(roleIds) {
  if (!roleIds || !roleIds.length) return [];
  const roles = await Role.find({ _id: { $in: roleIds } }).select("permissions").lean();
  const set = new Set();
  for (const role of roles) for (const p of role.permissions) set.add(p);
  return [...set];
}

/** Recompute one membership's denormalised permission list. */
async function recomputeMembership(membershipId) {
  const membership = await Membership.findById(membershipId);
  if (!membership) return null;
  membership.permissions = await permissionsForRoles(membership.roleIds);
  await membership.save();
  invalidateUser(String(membership.organizationId), String(membership.userId));
  return membership;
}

/** Recompute every membership that holds a given role. */
async function recomputeRoleMembers(roleId) {
  const memberships = await Membership.find({ roleIds: roleId }).select("_id").lean();
  for (const m of memberships) await recomputeMembership(m._id);
  return memberships.length;
}

async function assignRoles(membershipId, roleIds, req) {
  const membership = await Membership.findById(membershipId);
  if (!membership) throw AppError.notFound("Membership");

  const roles = await Role.find({ _id: { $in: roleIds } }).lean();
  if (roles.length !== roleIds.length) {
    throw AppError.badRequest("One or more of the selected roles do not exist.");
  }

  const before = membership.roleIds.map(String);

  // Guard the last owner. Losing every owner means nobody can restore access
  // without Chefotech support intervening.
  const ownerRole = await Role.findOne({ isOwner: true }).lean();
  if (ownerRole) {
    const hadOwner = before.includes(String(ownerRole._id));
    const keepsOwner = roleIds.map(String).includes(String(ownerRole._id));
    if (hadOwner && !keepsOwner) {
      const otherOwners = await Membership.countDocuments({
        roleIds: ownerRole._id,
        status: "active",
        _id: { $ne: membership._id },
      });
      if (otherOwners === 0) {
        throw AppError.conflict(
          "This is the only Owner. Give someone else the Owner role before removing it here."
        );
      }
    }
  }

  membership.roleIds = roleIds;
  membership.permissions = await permissionsForRoles(roleIds);
  await membership.save();
  invalidateUser(String(membership.organizationId), String(membership.userId));

  await audit.record(
    {
      action: "role.assigned",
      entityType: "Membership",
      entityId: membership._id,
      before: { roles: before },
      after: { roles: roleIds.map(String) },
      severity: "warning",
    },
    req
  );

  return membership;
}

/**
 * Resolve a user's access inside an organization. This runs on every
 * authenticated request, hence the short-lived cache.
 */
async function resolveAccess(organizationId, userId, { fresh = false } = {}) {
  const key = cacheKey(organizationId, userId);
  if (!fresh) {
    const hit = permissionCache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.entry;
  }

  const membership = await Membership.findOne({ userId, status: { $ne: "removed" } })
    .populate("roleIds", "key name isOwner rank")
    .lean();

  if (!membership) return null;

  const isOwner = (membership.roleIds || []).some((r) => r.isOwner);

  const entry = {
    membershipId: String(membership._id),
    employeeId: membership.employeeId ? String(membership.employeeId) : null,
    status: membership.status,
    // The Owner role's stored `permissions` is a snapshot taken the moment
    // the organization was created (or the role last saved) — it does not
    // grow when a new permission is added to the registry later, because
    // "*" is expanded to a concrete list at write time, not resolved live.
    // Recomputing every tenant's Owner role each time the registry grows is
    // a migration this platform would need to remember forever and will
    // eventually forget once. Reading it live here instead means "Owner
    // always has full access" is actually always true, for every tenant,
    // the moment a permission is registered — matching what `updateRole()`
    // already promises and refuses to let anyone break.
    permissions: isOwner ? ALL_PERMISSIONS : membership.permissions || [],
    roles: (membership.roleIds || []).map((r) => ({
      id: String(r._id),
      key: r.key,
      name: r.name,
      isOwner: r.isOwner,
    })),
    isOwner,
    isManager: Boolean(membership.isManager),
  };

  permissionCache.set(key, { entry, expiresAt: Date.now() + CACHE_TTL_MS });
  return entry;
}

module.exports = {
  seedRoles,
  listRoles,
  getRole,
  createRole,
  updateRole,
  deleteRole,
  assignRoles,
  permissionsForRoles,
  recomputeMembership,
  recomputeRoleMembers,
  resolveAccess,
  invalidateUser,
  invalidateOrganization,
  Role,
  Membership,
};
