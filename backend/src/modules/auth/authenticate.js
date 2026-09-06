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
      // ── Machine callers: an API key instead of a session ────────────────
      // The key carries a subset of its creator's permissions and is scoped
      // to one organization, so everything below the tenant check is the
      // same as for a person.
      const apiKey = req.headers["x-api-key"];
      if (apiKey && !options.optional) {
        const integrations = require("../integrations/integration.service");
        const key = await integrations.resolveApiKey(String(apiKey), req.ip);
        if (!key) throw new AppError("UNAUTHENTICATED", { message: "This API key is not valid, has expired, or was revoked." });

        const organization = await loadOrganization(key.organizationId);
        if (!organization || organization.deletedAt) throw new AppError("UNAUTHENTICATED");
        if (organization.status === "suspended" || organization.status === "cancelled") throw new AppError("ORGANIZATION_SUSPENDED");

        req.auth = {
          userId: String(key.createdBy),
          email: null,
          name: `API key: ${key.name}`,
          firstName: key.name,
          isPlatformUser: false,
          isApiKey: true,
          apiKeyId: String(key._id),
          organizationId: String(organization._id),
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
          membershipId: null,
          employeeId: null,
          permissions: key.scopes || [],
          roles: [],
          isOwner: false,
          isManager: false,
        };
        return tenant.runWithTenant(organization._id, () => next(), { userId: String(key.createdBy), requestId: req.id }).catch(next);
      }

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

      // The organization's IP allowlist, on every request rather than only
      // at sign-in: a session that started in the office must not keep
      // working from a café. Reads through the settings cache, so it costs
      // nothing measurable. Only tenant users are subject to it.
      await tenant.runWithTenant(organizationId, () =>
        require("./security.service").assertIpAllowed(organizationId, req.ip)
      );

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
