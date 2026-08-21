"use strict";

const { AppError } = require("../errors/AppError");

/**
 * Authorization guards.
 *
 * The frontend hides what a user cannot do; the backend is what actually
 * decides. Every mutating route carries a guard from this file — there is no
 * "the UI never shows this button" reasoning anywhere in the API.
 */

function permissionsOf(req) {
  return (req.auth && req.auth.permissions) || [];
}

function has(req, permission) {
  const perms = permissionsOf(req);
  return perms.includes(permission);
}

/** All of the listed permissions are required. */
function requirePermission(...required) {
  const needed = required.flat();
  return function guard(req, _res, next) {
    if (!req.auth) return next(new AppError("UNAUTHENTICATED"));
    const missing = needed.filter((p) => !has(req, p));
    if (missing.length) {
      return next(
        new AppError("PERMISSION_DENIED", {
          meta: { missing, userId: req.auth.userId },
          details: { required: needed },
        })
      );
    }
    return next();
  };
}

/** Any one of the listed permissions is enough. */
function requireAnyPermission(...options) {
  const any = options.flat();
  return function guard(req, _res, next) {
    if (!req.auth) return next(new AppError("UNAUTHENTICATED"));
    if (any.some((p) => has(req, p))) return next();
    return next(
      new AppError("PERMISSION_DENIED", {
        meta: { anyOf: any, userId: req.auth.userId },
        details: { requiredAnyOf: any },
      })
    );
  };
}

/** Chefotech staff only. Tenant users can never reach these routes. */
function requirePlatformRole(...roles) {
  const allowed = roles.flat();
  return function guard(req, _res, next) {
    if (!req.auth) return next(new AppError("UNAUTHENTICATED"));
    if (!req.auth.isPlatformUser) return next(new AppError("NOT_FOUND"));
    if (allowed.length && !allowed.includes(req.auth.platformRole)) {
      return next(new AppError("PERMISSION_DENIED"));
    }
    return next();
  };
}

/**
 * Resolve how wide a user's view of employee data is.
 *
 *   "org"  – sees everyone (has the org-wide or the broad view permission)
 *   "team" – sees their reporting tree only
 *   "self" – sees only their own record
 *
 * Services turn this into a Mongo filter via `employeeScopeFilter`, so scope
 * is applied at the query, never by filtering an already-fetched list.
 */
function resolveDataScope(req, { orgPermission, teamPermission }) {
  if (orgPermission && has(req, orgPermission)) return "org";
  if (teamPermission && has(req, teamPermission)) return "team";
  return "self";
}

module.exports = {
  requirePermission,
  requireAnyPermission,
  requirePlatformRole,
  resolveDataScope,
  hasPermission: has,
};
