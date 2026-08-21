"use strict";

const AuditLog = require("./auditLog.model");
const { logger } = require("../../config/logger");
const tenant = require("../tenancy/tenantContext");

/**
 * Values that must never be written into the audit trail in the clear.
 * The trail records THAT a salary changed and by how much at the field level,
 * but never a password hash, a token, or a device credential.
 */
const MASKED_FIELDS = new Set([
  "password",
  "passwordHash",
  "refreshTokenHashes",
  "mfaSecret",
  "apiKey",
  "apiSecret",
  "devicePassword",
  "serviceAccountKey",
  "token",
  "secret",
  "webhookSecret",
]);

function mask(value) {
  if (value === null || value === undefined) return value;
  return "[redacted]";
}

function sanitise(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(sanitise);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (MASKED_FIELDS.has(k)) out[k] = mask(v);
    else if (v && typeof v === "object" && !(v instanceof Date)) out[k] = sanitise(v);
    else out[k] = v;
  }
  return out;
}

function isEqual(a, b) {
  if (a === b) return true;
  if (a instanceof Date || b instanceof Date) {
    return new Date(a).getTime() === new Date(b).getTime();
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/** Compute the changed-field diff between two plain objects. */
function diff(before, after, ignore = ["updatedAt", "createdAt", "updatedBy", "__v"]) {
  const changed = [];
  const beforeOut = {};
  const afterOut = {};
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of keys) {
    if (ignore.includes(key)) continue;
    const a = before ? before[key] : undefined;
    const b = after ? after[key] : undefined;
    if (isEqual(a, b)) continue;
    changed.push(key);
    beforeOut[key] = a;
    afterOut[key] = b;
  }
  return { changedFields: changed, before: beforeOut, after: afterOut };
}

/**
 * Record an audited event.
 *
 * Audit writes never break the business operation that triggered them: a
 * failure is logged loudly but does not roll back an approved leave request.
 * Losing a trail entry is bad; losing the user's work because the trail was
 * unavailable is worse.
 */
async function record(entry, req) {
  try {
    const organizationId =
      entry.organizationId !== undefined
        ? entry.organizationId
        : tenant.getOrganizationId();

    const payload = {
      organizationId: organizationId || null,
      actorId: entry.actorId || (req && req.auth && req.auth.userId) || tenant.getUserId(),
      actorName: entry.actorName || (req && req.auth && req.auth.name) || null,
      actorEmail: entry.actorEmail || (req && req.auth && req.auth.email) || null,
      actorType: entry.actorType || (req ? "user" : "system"),
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId || null,
      entityLabel: entry.entityLabel || null,
      severity: entry.severity || "info",
      description: entry.description || null,
      ip: (req && (req.ip || req.headers["x-forwarded-for"])) || null,
      userAgent: (req && req.headers && req.headers["user-agent"]) || null,
      requestId: (req && req.id) || null,
      occurredAt: entry.occurredAt || new Date(),
    };

    if (entry.before || entry.after) {
      const d = diff(sanitise(entry.before), sanitise(entry.after));
      payload.before = d.before;
      payload.after = d.after;
      payload.changedFields = d.changedFields;
      // A "changed" event where nothing actually changed is noise.
      if (!d.changedFields.length && entry.skipIfUnchanged) return null;
    }

    return await AuditLog.create(payload);
  } catch (err) {
    logger.error({ err, action: entry && entry.action }, "Failed to write audit entry");
    return null;
  }
}

/** Read the trail for one entity, newest first. */
async function forEntity(entityType, entityId, { limit = 50 } = {}) {
  return AuditLog.find({
    organizationId: tenant.requireOrganizationId(),
    entityType,
    entityId,
  })
    .sort({ occurredAt: -1 })
    .limit(limit)
    .lean();
}

module.exports = { record, forEntity, diff, sanitise, AuditLog };
