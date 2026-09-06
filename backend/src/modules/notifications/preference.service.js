"use strict";

const NotificationPreference = require("./notificationPreference.model");
const { AppError } = require("../../core/errors/AppError");
const dt = require("../../shared/datetime");

const cache = new Map(); // userId -> { pref, expiresAt }
const CACHE_TTL_MS = 60_000;

const DEFAULTS = {
  emailEnabled: true,
  pushEnabled: true,
  muted: [],
  quietHours: { enabled: false, start: "22:00", end: "07:00" },
  dailyDigest: true,
};

function shape(doc) {
  if (!doc) return { ...DEFAULTS, isDefault: true };
  return {
    emailEnabled: doc.emailEnabled,
    pushEnabled: doc.pushEnabled,
    muted: (doc.muted || []).map((m) => ({ category: m.category, channel: m.channel })),
    quietHours: { ...DEFAULTS.quietHours, ...(doc.quietHours || {}) },
    dailyDigest: doc.dailyDigest !== false,
    isDefault: false,
  };
}

async function forUser(userId) {
  const key = String(userId);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.pref;

  const doc = await NotificationPreference.findOne({ userId }).lean();
  const pref = shape(doc);
  cache.set(key, { pref, expiresAt: Date.now() + CACHE_TTL_MS });
  return pref;
}

/** Many at once, so notify() does one query for a broadcast, not N. */
async function forUsers(userIds) {
  const ids = [...new Set(userIds.filter(Boolean).map(String))];
  const out = new Map();
  const missing = [];

  for (const id of ids) {
    const hit = cache.get(id);
    if (hit && hit.expiresAt > Date.now()) out.set(id, hit.pref);
    else missing.push(id);
  }

  if (missing.length) {
    const docs = await NotificationPreference.find({ userId: { $in: missing } }).lean();
    const byUser = Object.fromEntries(docs.map((d) => [String(d.userId), d]));
    for (const id of missing) {
      const pref = shape(byUser[id]);
      cache.set(id, { pref, expiresAt: Date.now() + CACHE_TTL_MS });
      out.set(id, pref);
    }
  }
  return out;
}

async function update(userId, patch) {
  const allowed = {};
  if (patch.emailEnabled !== undefined) allowed.emailEnabled = Boolean(patch.emailEnabled);
  if (patch.pushEnabled !== undefined) allowed.pushEnabled = Boolean(patch.pushEnabled);
  if (patch.dailyDigest !== undefined) allowed.dailyDigest = Boolean(patch.dailyDigest);
  if (patch.muted !== undefined) {
    if (!Array.isArray(patch.muted)) throw AppError.badRequest("muted must be a list");
    allowed.muted = patch.muted.map((m) => ({ category: m.category, channel: m.channel }));
  }
  if (patch.quietHours !== undefined) {
    const q = patch.quietHours || {};
    for (const field of ["start", "end"]) {
      if (q[field] !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(q[field]))) {
        throw AppError.validation([{ field: `quietHours.${field}`, message: "Use the format HH:mm" }]);
      }
    }
    allowed.quietHours = { ...DEFAULTS.quietHours, ...q };
  }

  const doc = await NotificationPreference.findOneAndUpdate(
    { userId },
    { $set: { ...allowed, userId } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  cache.delete(String(userId));
  return shape(doc);
}

/** Does this person want this channel for this category, right now? */
function allows(pref, channel, category, { timezone } = {}) {
  if (!pref) return true;
  if (channel === "in_app") return true;
  if (channel === "email" && !pref.emailEnabled) return false;
  if (channel === "push" && !pref.pushEnabled) return false;
  if ((pref.muted || []).some((m) => m.channel === channel && m.category === category)) return false;
  if (channel === "push" && inQuietHours(pref, timezone)) return false;
  return true;
}

function inQuietHours(pref, timezone) {
  const q = pref && pref.quietHours;
  if (!q || !q.enabled) return false;
  const now = dt.nowIn(timezone);
  const minutes = now.hour() * 60 + now.minute();
  const start = dt.timeToMinutes(q.start || "22:00");
  const end = dt.timeToMinutes(q.end || "07:00");
  // A window that crosses midnight (22:00 → 07:00) is the common case.
  return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

function invalidate(userId) {
  cache.delete(String(userId));
}

module.exports = {
  forUser,
  forUsers,
  update,
  allows,
  inQuietHours,
  invalidate,
  DEFAULTS,
  NotificationPreference,
};
