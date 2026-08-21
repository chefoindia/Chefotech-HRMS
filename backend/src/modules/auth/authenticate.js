"use strict";

const User = require("../users/user.model");
const Organization = require("../organizations/organization.model");
const rbac = require("../rbac/rbac.service");
const tokens = require("./tokens");
const { AppError } = require("../../core/errors/AppError");
const tenant = require("../../core/tenancy/tenantContext");

/**
 * The authentication middleware.
 *
 * This is the single place where a request acquires an identity AND a tenant.
 * Note what is NOT here: nothing reads an organization id from the body, the
 * query string, or a header. The tenant comes from the signed token and is
 * confirmed against a live membership lookup, so a user cannot reach another
 * organization by editing a request.
 *
 * The rest of the request is then executed inside `runWithTenant`, which is
 * what lets the mongoose plugin scope every query without any service having
 * to remember to.
 */

const orgCache = new Map();
const ORG_CACHE_TTL_MS = 30_000;

async function loadOrganization(organizationId) {
  const key = String(organizationId);
  const hit = orgCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.org;

  const org = await Organization.findById(organizationId).lean();
  orgCache.set(key, { org, expiresAt: Date.now() + ORG_CACHE_TTL_MS });
  return org;
}

function invalidateOrganizationCache(organizationId) {
  orgCache.delete(String(organizationId));
}

/**
 * @param {object} [options]
 * @param {boolean} [options.optional]  attach identity if present, never 401
 * @param {boolean} [options.allowNoOrganization]  for endpoints used between
 *        sign-in and picking an organization (e.g. GET /auth/organizations)
 */
function authenticate(options = {}) {
  return async function authenticateMiddleware(req, res, next) {
    try {
      const token = tokens.extractToken(req);

      if (!token) {
        if (options.optional) return next();
        throw new AppError("UNAUTHENTICATED");
      }

      const payload = tokens.verifyAccessToken(token);

      const user = await User.findById(payload.sub).lean();
      if (!user || user.deletedAt) throw new AppError("UNAUTHENTICATED");
      if (user.status === "disabled") throw new AppError("ACCOUNT_DISABLED");

      // ── Chefotech platform staff ────────────────────────────────────────
      if (user.isPlatformUser) {
        req.auth = {
          userId: String(user._id),
          email: user.email,
          name: [user.firstName, user.lastName].filter(Boolean).join(" "),
          isPlatformUser: true,
          platformRole: user.platformRole,
          organizationId: null,
          permissions: [],
        };
        // Platform routes open their own system context per operation, so the
        // default here stays deliberately narrow.
        return next();
      }

      // ── Tenant users ────────────────────────────────────────────────────
      const organizationId = payload.org;
      if (!organizationId) {
        if (options.allowNoOrganization) {
          req.auth = {
            userId: String(user._id),
            email: user.email,
            name: [user.firstName, user.lastName].filter(Boolean).join(" "),
            isPlatformUser: false,
            organizationId: null,
            permissions: [],
          };
          return next();
        }
        throw new AppError("TENANT_CONTEXT_MISSING");
      }

      const organization = await loadOrganization(organizationId);
      if (!organization || organization.deletedAt) throw new AppError("UNAUTHENTICATED");
      if (organization.status === "suspended" || organization.status === "cancelled") {
        throw new AppError("ORGANIZATION_SUSPENDED", {
          message:
            organization.suspendedReason ||
            "This organization is suspended. Please contact support.",
        });
      }

      // Membership is re-checked on every request, not trusted from the token.
      // Removing someone from an organization takes effect immediately.
      const access = await tenant.runWithTenant(organizationId, () =>
        rbac.resolveAccess(organizationId, String(user._id))
      );

      if (!access) throw new AppError("UNAUTHENTICATED");
      if (access.status === "suspended") {
        throw new AppError("ACCOUNT_DISABLED", {
          message: "Your access to this organization has been suspended.",
        });
      }
      if (access.status === "removed") throw new AppError("UNAUTHENTICATED");

      req.auth = {
        userId: String(user._id),
        email: user.email,
        name: [user.firstName, user.lastName].filter(Boolean).join(" "),
        firstName: user.firstName,
        isPlatformUser: false,
        organizationId: String(organizationId),
        organization: {
          id: String(organization._id),
          name: organization.name,
          slug: organization.slug,
          timezone: organization.timezone,
          currency: organization.currency,
          status: organization.status,
          plan: organization.plan,
          featureOverrides: organization.featureOverrides,
          storageFolderName: `${organization.slug}-${String(organization._id).slice(-6)}`,
        },
        membershipId: access.membershipId,
        employeeId: access.employeeId,
        permissions: access.permissions,
        roles: access.roles,
        isOwner: access.isOwner,
        isManager: access.isManager,
      };

      // Everything downstream runs inside the tenant. runWithTenant returns a
      // promise now; nothing awaits it here, so a rejection is routed back to
      // the error handler rather than surfacing as an unhandled rejection.
      return tenant
        .runWithTenant(organizationId, () => next(), {
          userId: String(user._id),
          requestId: req.id,
        })
        .catch(next);
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { authenticate, invalidateOrganizationCache };
