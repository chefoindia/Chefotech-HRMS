"use strict";

const { AsyncLocalStorage } = require("node:async_hooks");
const { AppError } = require("../errors/AppError");

/**
 * Ambient tenant context.
 *
 * The organization a request operates on is derived ONCE, from the verified
 * access token plus a membership lookup, and then carried implicitly through
 * every async hop via AsyncLocalStorage. Nothing downstream — service, model,
 * job — ever takes an organizationId from the client.
 *
 * The mongoose tenant plugin reads this store on every query. That inverts the
 * usual failure mode: forgetting to scope a query throws instead of silently
 * leaking another tenant's data.
 */
const storage = new AsyncLocalStorage();

/**
 * @typedef {Object} TenantStore
 * @property {string|null} organizationId
 * @property {string|null} userId
 * @property {string|null} requestId
 * @property {boolean} system   true => cross-tenant access is intentional
 * @property {string|null} reason  why a system context was opened (audited)
 */

function getStore() {
  return storage.getStore() || null;
}

/** The current organization id, or null when running as system/no context. */
function getOrganizationId() {
  const store = getStore();
  return store ? store.organizationId : null;
}

/** Organization id, or throw. Use in services that must be tenant-scoped. */
function requireOrganizationId() {
  const orgId = getOrganizationId();
  if (!orgId) throw new AppError("TENANT_CONTEXT_MISSING");
  return orgId;
}

function getUserId() {
  const store = getStore();
  return store ? store.userId : null;
}

function isSystemContext() {
  const store = getStore();
  return Boolean(store && store.system);
}

/**
 * Run `fn` with a tenant bound. All DB access inside is scoped to it.
 *
 * `fn` is wrapped in an async shim rather than passed straight to
 * AsyncLocalStorage.run. Without the shim, a callback that RETURNS an
 * unexecuted value — a mongoose Query is the common case, since it only runs
 * when awaited — would escape the context and execute outside it, losing the
 * tenant scope at exactly the moment it matters. The shim keeps the context
 * alive until the returned promise settles.
 */
function runWithTenant(organizationId, fn, extra = {}) {
  if (!organizationId) throw new AppError("TENANT_CONTEXT_MISSING");
  return storage.run(
    {
      organizationId: String(organizationId),
      userId: extra.userId ? String(extra.userId) : null,
      requestId: extra.requestId || null,
      system: false,
      reason: null,
    },
    async () => fn()
  );
}

/**
 * Grant the ABILITY to read across tenants. Only three callers are
 * legitimate: platform bootstrap, the super-admin module, and background jobs
 * that iterate organizations (each of which re-enters runWithTenant per org).
 *
 * Note what this does NOT do: it does not forget which tenant we are in. An
 * ambient organization is carried through, so code inside a system block can
 * still ask "which tenant am I serving" — and, crucially, a query inside a
 * system block is still scoped to that tenant unless it also says
 * `.bypassTenant()`. System access is opt-in per query, not a mode where
 * everything silently becomes global.
 */
function runAsSystem(fn, reason = "unspecified") {
  const current = getStore();
  return storage.run(
    {
      organizationId: current ? current.organizationId : null,
      userId: current ? current.userId : null,
      requestId: current ? current.requestId : null,
      system: true,
      reason,
    },
    // Same shim as runWithTenant — see the note there.
    async () => fn()
  );
}

/** Escape hatch used by the plugin's `.bypassTenant()` query option. */
function assertSystemAllowed(operation) {
  if (!isSystemContext()) {
    throw new AppError("TENANT_CONTEXT_MISSING", {
      meta: { operation },
      message: "This operation requires an organization context.",
    });
  }
}

module.exports = {
  storage,
  getStore,
  getOrganizationId,
  requireOrganizationId,
  getUserId,
  isSystemContext,
  runWithTenant,
  runAsSystem,
  assertSystemAllowed,
};
