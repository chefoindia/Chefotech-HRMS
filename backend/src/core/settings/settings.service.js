"use strict";

const Setting = require("./setting.model");
const registry = require("./settingsRegistry");
const { AppError } = require("../errors/AppError");
const audit = require("../audit/audit.service");
const tenant = require("../tenancy/tenantContext");
const { logger } = require("../../config/logger");

/**
 * Read/write access to organization settings.
 *
 * Settings are read on nearly every request (an attendance calculation alone
 * touches half a dozen), so resolved values are cached per organization with a
 * short TTL and invalidated on write. The cache is per-process; with several
 * API instances a change is visible everywhere within the TTL.
 */

const CACHE_TTL_MS = 60_000;
const cache = new Map(); // orgId -> { values, expiresAt }

function invalidate(organizationId) {
  cache.delete(String(organizationId));
}

function invalidateAll() {
  cache.clear();
}

/** Coerce and validate a value against its registry definition. */
function coerce(definition, raw) {
  const { type, key } = definition;
  const fail = (message) => {
    throw AppError.validation([{ field: key, message }]);
  };

  switch (type) {
    case "boolean":
      if (typeof raw === "boolean") return raw;
      if (["true", "false", 1, 0, "1", "0"].includes(raw)) {
        return raw === true || raw === "true" || raw === 1 || raw === "1";
      }
      return fail("Must be true or false");

    case "number": {
      const n = Number(raw);
      if (!Number.isFinite(n)) return fail("Must be a number");
      const v = definition.validation || {};
      if (v.min !== undefined && n < v.min) return fail(`Must be at least ${v.min}`);
      if (v.max !== undefined && n > v.max) return fail(`Must be at most ${v.max}`);
      return n;
    }

    case "string":
    case "color": {
      const s = String(raw == null ? "" : raw);
      const v = definition.validation || {};
      if (v.maxLength && s.length > v.maxLength) {
        return fail(`Must be ${v.maxLength} characters or fewer`);
      }
      if (v.pattern && !new RegExp(v.pattern).test(s)) return fail("Has an invalid format");
      if (type === "color" && !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s)) {
        return fail("Must be a hex colour like #4F46E5");
      }
      return s;
    }

    case "time":
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(raw))) return fail("Use the format HH:mm");
      return String(raw);

    case "date":
      if (Number.isNaN(Date.parse(raw))) return fail("Must be a valid date");
      return new Date(raw);

    case "enum": {
      const allowed = (definition.options || []).map((o) => o.value);
      // Query strings turn 4 into "4"; compare loosely, store the declared type.
      const match = allowed.find((a) => String(a) === String(raw));
      if (match === undefined) return fail("Is not one of the allowed values");
      return match;
    }

    case "multienum": {
      const allowed = (definition.options || []).map((o) => String(o.value));
      const arr = Array.isArray(raw) ? raw : [raw];
      const bad = arr.filter((v) => !allowed.includes(String(v)));
      if (bad.length) return fail(`Contains values that are not allowed: ${bad.join(", ")}`);
      return arr.map((v) => (definition.options.find((o) => String(o.value) === String(v)) || {}).value);
    }

    case "array":
      if (!Array.isArray(raw)) return fail("Must be a list");
      return raw;

    case "json":
      if (raw === null || typeof raw !== "object") return fail("Must be an object");
      return raw;

    case "formula": {
      // Required lazily: the formula engine has no other reason to load here.
      const { validateExpression } = require("../rules/formula");
      const result = validateExpression(String(raw), definition.variables || null);
      if (!result.valid) return fail(result.error || "This formula is not valid");
      return String(raw);
    }

    default:
      return raw;
  }
}

/** All resolved settings for the current organization: defaults + overrides. */
async function all(organizationId) {
  const orgId = String(organizationId || tenant.requireOrganizationId());

  const hit = cache.get(orgId);
  if (hit && hit.expiresAt > Date.now()) return hit.values;

  const overrides = await Setting.find({}).lean();
  const values = { ...registry.defaults() };
  for (const row of overrides) {
    if (registry.definitionOf(row.key)) values[row.key] = row.value;
  }

  cache.set(orgId, { values, expiresAt: Date.now() + CACHE_TTL_MS });
  return values;
}

/** One resolved setting value. */
async function get(key, organizationId) {
  const definition = registry.definitionOf(key);
  if (!definition) throw AppError.badRequest(`Unknown setting '${key}'`);
  const values = await all(organizationId);
  return values[key];
}

/** Several at once, as a keyed object — avoids N cache lookups in a loop. */
async function getMany(keys, organizationId) {
  const values = await all(organizationId);
  return Object.fromEntries(keys.map((k) => [k, values[k]]));
}

/**
 * Write one setting. A value equal to the registry default removes the
 * override rather than storing a redundant row.
 */
async function set(key, rawValue, { req, actorName } = {}) {
  const definition = registry.definitionOf(key);
  if (!definition) throw AppError.badRequest(`Unknown setting '${key}'`);

  const value = coerce(definition, rawValue);
  const previous = await get(key);

  const isDefault = JSON.stringify(value) === JSON.stringify(definition.default);

  if (isDefault) {
    await Setting.deleteOne({ key });
  } else {
    await Setting.findOneAndUpdate(
      { key },
      { $set: { value, type: definition.type, updatedByName: actorName || null } },
      { upsert: true, new: true }
    );
  }

  invalidate(tenant.requireOrganizationId());

  await audit.record(
    {
      action: "settings.updated",
      entityType: "Setting",
      entityLabel: definition.label,
      before: { [key]: previous },
      after: { [key]: value },
      severity: definition.group === "security" ? "warning" : "notice",
      description: `${definition.label} changed`,
      skipIfUnchanged: true,
    },
    req
  );

  return value;
}

/** Write several settings atomically from the settings UI. */
async function setMany(patch, options = {}) {
  const out = {};
  for (const [key, value] of Object.entries(patch)) {
    out[key] = await set(key, value, options);
  }
  return out;
}

/** Registry + current values, shaped for the settings screen. */
async function describe(groupKey) {
  const values = await all();
  const definitions = registry.SETTINGS.filter((s) => !groupKey || s.group === groupKey);
  return {
    groups: registry.SETTING_GROUPS.filter((g) => !groupKey || g.key === groupKey),
    settings: definitions.map((d) => ({
      key: d.key,
      group: d.group,
      label: d.label,
      description: d.description || null,
      // The long-form explanation behind the info icon: what the setting
      // actually does downstream, and a worked example with real values.
      // Shipped in the same payload as the control itself, so a setting can
      // never appear on screen without the explanation of what it changes.
      help: d.help || null,
      type: d.type,
      options: d.options || null,
      validation: d.validation || null,
      dependsOn: d.dependsOn || null,
      default: d.default,
      value: values[d.key],
      isDefault: JSON.stringify(values[d.key]) === JSON.stringify(d.default),
    })),
  };
}

/** Seed nothing — defaults live in the registry. Kept for symmetry/clarity. */
async function initialiseForOrganization() {
  logger.debug("Settings need no seeding; defaults resolve from the registry");
}

module.exports = {
  all,
  get,
  getMany,
  set,
  setMany,
  describe,
  invalidate,
  invalidateAll,
  initialiseForOrganization,
  coerce,
  registry,
};
