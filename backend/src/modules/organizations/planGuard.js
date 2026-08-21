"use strict";

const { AppError } = require("../../core/errors/AppError");
const { planOf } = require("./plans");

/**
 * Plan feature and limit enforcement.
 *
 * Modules never read `organization.plan.code`. They ask whether a feature is
 * available or whether a limit has room, so pricing can change without a code
 * change — and so a support agent can enable one feature for one customer via
 * `featureOverrides` without inventing a bespoke plan.
 */

function featuresFor(organization) {
  if (!organization) return [];
  const base = new Set((organization.plan && organization.plan.features) || planOf().features);

  // Per-organization overrides win in both directions.
  const overrides = organization.featureOverrides;
  if (overrides) {
    const entries = overrides instanceof Map ? [...overrides.entries()] : Object.entries(overrides);
    for (const [feature, enabled] of entries) {
      if (enabled) base.add(feature);
      else base.delete(feature);
    }
  }
  return [...base];
}

function hasFeature(organization, feature) {
  return featuresFor(organization).includes(feature);
}

/** Route guard: 402 when the plan does not include this capability. */
function requireFeature(feature) {
  return function featureGuard(req, _res, next) {
    if (!req.auth || !req.auth.organization) return next(new AppError("UNAUTHENTICATED"));
    if (hasFeature(req.auth.organization, feature)) return next();
    return next(
      new AppError("FEATURE_NOT_AVAILABLE", {
        details: { feature, plan: req.auth.organization.plan && req.auth.organization.plan.code },
      })
    );
  };
}

/**
 * Check a countable limit before creating something.
 *
 * @param {object} organization
 * @param {string} limitKey  employees | admins | biometricDevices | storageMb
 * @param {number} currentCount
 * @param {number} [adding=1]
 */
function assertLimit(organization, limitKey, currentCount, adding = 1) {
  const limits = (organization.plan && organization.plan.limits) || {};
  const max = limits[limitKey];
  if (max === undefined || max === null) return;
  if (currentCount + adding <= max) return;

  throw new AppError("PLAN_LIMIT_REACHED", {
    message: `Your ${(organization.plan && organization.plan.name) || "current"} plan allows ${max} ${humanise(limitKey)}. Upgrade to add more.`,
    details: { limit: limitKey, max, current: currentCount },
  });
}

function humanise(limitKey) {
  return (
    {
      employees: "employees",
      admins: "administrators",
      biometricDevices: "biometric devices",
      storageMb: "MB of storage",
    }[limitKey] || limitKey
  );
}

function remaining(organization, limitKey, currentCount) {
  const limits = (organization.plan && organization.plan.limits) || {};
  const max = limits[limitKey];
  if (max === undefined || max === null) return Infinity;
  return Math.max(0, max - currentCount);
}

module.exports = { requireFeature, hasFeature, featuresFor, assertLimit, remaining };
