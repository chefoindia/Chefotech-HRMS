"use strict";

const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const User = require("../users/user.model");
const Organization = require("../organizations/organization.model");
const totp = require("../../core/security/totp");
const ipRange = require("../../core/security/ipRange");
const secretBox = require("../../core/security/secretBox");
const settings = require("../../core/settings/settings.service");
const tokens = require("./tokens");
const { AppError } = require("../../core/errors/AppError");
const { env } = require("../../config/env");
const { logger } = require("../../config/logger");
const tenant = require("../../core/tenancy/tenantContext");
const audit = require("../../core/audit/audit.service");
const notifications = require("../notifications/notification.service");

/**
 * Account security: two-factor authentication, the organization's sign-in
 * policies (IP allowlist, idle timeout, password rules) and session
 * management.
 *
 * The settings for all of this have existed in the registry for a while;
 * nothing read them. A customer who switched on "restrict access to IP
 * ranges" got a saved value and no restriction, which is worse than not
 * having the setting.
 */

const MFA_AUDIENCE = "hrms-mfa";
const MFA_TTL = "5m";

/** Permissions that make an account "administrative" for two-factor enforcement. */
const ADMIN_PERMISSIONS = [
  "settings.manage",
  "settings.manage_security",
  "user.invite",
  "user.update",
  "role.manage",
  "role.assign",
  "employee.view_sensitive",
  "employee.export",
  "payroll.process",
  "payroll.approve",
  "payroll.export",
  "audit.export",
];

function isAdministrative(permissions = []) {
  const set = new Set(permissions);
  return ADMIN_PERMISSIONS.some((p) => set.has(p));
}

// ── Organization policies ───────────────────────────────────────────────────

/**
 * The security policy of an organization, read through the settings cache.
 * Safe to call on every request: the settings service memoises per tenant.
 */
async function policyFor(organizationId) {
  const keys = ["security.session_idle_minutes", "security.password_min_length", "security.password_expiry_days", "security.enforce_two_factor", "security.allowed_ip_ranges"];
  // Sign-in runs before any tenant context exists; settings reads need one.
  const current = tenant.getOrganizationId();
  const values =
    current && String(current) === String(organizationId)
      ? await settings.getMany(keys, organizationId)
      : await tenant.runWithTenant(organizationId, () => settings.getMany(keys, organizationId), { reason: "security.policy" });
  return {
    idleMinutes: Number(values["security.session_idle_minutes"]) || 480,
    passwordMinLength: Number(values["security.password_min_length"]) || 10,
    passwordExpiryDays: Number(values["security.password_expiry_days"]) || 0,
    enforceTwoFactor: Boolean(values["security.enforce_two_factor"]),
    allowedIpRanges: Array.isArray(values["security.allowed_ip_ranges"]) ? values["security.allowed_ip_ranges"] : [],
  };
}

/** Throws when the organization restricts sign-in by network and this address is outside it. */
async function assertIpAllowed(organizationId, address) {
  const policy = await policyFor(organizationId);
  if (!policy.allowedIpRanges.length) return;
  if (ipRange.isAllowed(address, policy.allowedIpRanges)) return;
  logger.warn({ organizationId: String(organizationId), ip: address }, "Sign-in refused: address outside the allowed ranges");
  throw new AppError("IP_NOT_ALLOWED");
}

/**
 * The password rules that apply to a user. Length comes from the organization
 * they last used; someone signing up has no organization yet and gets the
 * platform default. The character classes are fixed platform-wide.
 */
async function assertPasswordPolicy(password, organizationId) {
  const minLength = organizationId ? (await policyFor(organizationId)).passwordMinLength : 10;
  const value = String(password || "");
  const problems = [];
  if (value.length < minLength) problems.push(`Password must be at least ${minLength} characters.`);
  if (!/[a-z]/.test(value)) problems.push("Password must contain a lowercase letter.");
  if (!/[A-Z]/.test(value)) problems.push("Password must contain an uppercase letter.");
  if (!/[0-9]/.test(value)) problems.push("Password must contain a number.");
  if (problems.length) {
    throw AppError.validation(problems.map((message) => ({ field: "password", message })), problems[0]);
  }
}

/** Whether a password set at `changedAt` has aged past the organization's limit. */
async function passwordExpired(user, organizationId) {
  if (!organizationId) return false;
  const policy = await policyFor(organizationId);
  if (!policy.passwordExpiryDays) return false;
  const since = user.passwordChangedAt || user.createdAt;
  if (!since) return false;
  return Date.now() - new Date(since).getTime() > policy.passwordExpiryDays * 86400000;
}

/**
 * Idle timeout: a refresh token that has not been used for longer than the
 * organization allows is dead, however long its nominal life. The access
 * token is short-lived, so "not used" means "no refresh", which means no
 * activity — which is the definition of idle.
 */
async function assertNotIdle(entry, organizationId) {
  if (!organizationId) return;
  const policy = await policyFor(organizationId);
  const lastActivity = entry.lastUsedAt || entry.createdAt;
  if (!lastActivity) return;
  if (Date.now() - new Date(lastActivity).getTime() > policy.idleMinutes * 60000) {
    throw new AppError("SESSION_IDLE");
  }
}

// ── Two-factor authentication ───────────────────────────────────────────────

/** A short-lived token that proves the password step passed and nothing else. */
function signMfaToken(user, { organizationId } = {}) {
  return jwt.sign(
    { sub: String(user._id), org: organizationId ? String(organizationId) : null, purpose: "mfa" },
    env.jwt.accessSecret,
    { expiresIn: MFA_TTL, issuer: env.jwt.issuer, audience: MFA_AUDIENCE }
  );
}

function verifyMfaToken(token) {
  try {
    const payload = jwt.verify(token, env.jwt.accessSecret, { issuer: env.jwt.issuer, audience: MFA_AUDIENCE });
    if (payload.purpose !== "mfa") throw new Error("wrong purpose");
    return payload;
  } catch {
    throw new AppError("MFA_INVALID", { message: "This sign-in attempt has expired. Enter your password again." });
  }
}

function decryptSecret(user) {
  if (!user.mfaSecret) return null;
  try {
    const parsed = typeof user.mfaSecret === "string" && user.mfaSecret.startsWith("{") ? JSON.parse(user.mfaSecret) : null;
    return parsed ? secretBox.decrypt(parsed) : user.mfaSecret;
  } catch (err) {
    logger.error({ err, userId: String(user._id) }, "Could not decrypt an MFA secret");
    return null;
  }
}

function encryptSecret(secret) {
  return JSON.stringify(secretBox.encrypt(secret));
}

/**
 * Start enrolment: a new secret is generated and stored as *pending*. It
 * only becomes the account's second factor once the person proves their
 * app has it, by entering one code. Until then sign-in is unchanged.
 */
async function beginEnrolment(userId) {
  const user = await User.findById(userId).select("+mfaSecret +mfaPendingSecret");
  if (!user) throw new AppError("UNAUTHENTICATED");
  if (user.mfaEnabled) throw AppError.conflict("Two-factor authentication is already on. Turn it off before setting it up again.");

  const secret = totp.generateSecret();
  user.mfaPendingSecret = encryptSecret(secret);
  await user.save();

  const issuer = "ChefoTech HRMS";
  const url = totp.otpauthUrl({ secret, account: user.email, issuer });
  let qrDataUrl = null;
  try {
    const QRCode = require("qrcode");
    qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 220 });
  } catch (err) {
    logger.warn({ err }, "Could not draw the MFA QR; the manual key is still returned");
  }
  return { secret, otpauthUrl: url, qrDataUrl };
}

/** Finish enrolment: the first correct code switches it on and mints recovery codes. */
async function completeEnrolment(userId, token, req) {
  const user = await User.findById(userId).select("+mfaSecret +mfaPendingSecret +mfaRecoveryCodes");
  if (!user) throw new AppError("UNAUTHENTICATED");
  if (!user.mfaPendingSecret) throw AppError.badRequest("Start the setup first, then enter the code from your app.");

  const secret = decryptSecret({ ...user.toObject(), mfaSecret: user.mfaPendingSecret });
  const result = totp.verify(secret, token);
  if (!result.valid) throw new AppError("MFA_INVALID");

  const recoveryCodes = totp.generateRecoveryCodes(10);
  user.mfaSecret = user.mfaPendingSecret;
  user.mfaPendingSecret = null;
  user.mfaEnabled = true;
  user.mfaEnabledAt = new Date();
  user.mfaLastCounter = result.counter;
  user.mfaRecoveryCodes = recoveryCodes.map((code) => ({ hash: totp.hashRecoveryCode(code), usedAt: null }));
  await user.save();

  await audit.record(
    { organizationId: user.lastOrganizationId || null, actorId: user._id, actorEmail: user.email, action: "auth.mfa_enabled", entityType: "User", entityId: user._id, severity: "warning", description: "Two-factor authentication switched on" },
    req
  );
  notifications
    .sendTransactional({
      to: user.email,
      template: "mfa_changed",
      organizationId: user.lastOrganizationId,
      data: { firstName: user.firstName, state: "switched on", when: new Date().toLocaleString("en-GB", { timeZone: user.timezone || "Asia/Kolkata" }), ip: (req && req.ip) || "unknown" },
    })
    .catch((err) => logger.warn({ err }, "MFA-changed email failed"));

  return { enabled: true, recoveryCodes };
}

/** Turn it off. Needs the password and a current code, so a hijacked session cannot strip the protection. */
async function disable(userId, { password, token }, req) {
  const user = await User.findById(userId).select("+passwordHash +mfaSecret +mfaRecoveryCodes");
  if (!user) throw new AppError("UNAUTHENTICATED");
  if (!user.mfaEnabled) return { enabled: false };
  if (!(await user.verifyPassword(password))) throw new AppError("INVALID_CREDENTIALS", { message: "Your password is incorrect." });
  if (!(await checkSecondFactor(user, token))) throw new AppError("MFA_INVALID");

  // If the organization enforces two-factor for administrators, an admin
  // cannot simply turn it off; they can only re-enrol.
  if (user.lastOrganizationId) {
    const policy = await policyFor(user.lastOrganizationId);
    if (policy.enforceTwoFactor) {
      const rbac = require("../rbac/rbac.service");
      const access = await tenant.runWithTenant(user.lastOrganizationId, () => rbac.resolveAccess(user.lastOrganizationId, String(user._id)));
      if (access && isAdministrative(access.permissions)) {
        throw AppError.forbidden("Your organization requires two-factor authentication for administrators. You can set up a new authenticator, but not switch it off.");
      }
    }
  }

  user.mfaEnabled = false;
  user.mfaSecret = null;
  user.mfaPendingSecret = null;
  user.mfaRecoveryCodes = [];
  user.mfaLastCounter = null;
  await user.save();

  await audit.record(
    { organizationId: user.lastOrganizationId || null, actorId: user._id, actorEmail: user.email, action: "auth.mfa_disabled", entityType: "User", entityId: user._id, severity: "warning", description: "Two-factor authentication switched off" },
    req
  );
  notifications
    .sendTransactional({
      to: user.email,
      template: "mfa_changed",
      organizationId: user.lastOrganizationId,
      data: { firstName: user.firstName, state: "switched off", when: new Date().toLocaleString("en-GB", { timeZone: user.timezone || "Asia/Kolkata" }), ip: (req && req.ip) || "unknown" },
    })
    .catch((err) => logger.warn({ err }, "MFA-changed email failed"));
  return { enabled: false };
}

/** Fresh recovery codes; the old set stops working. Needs a current code. */
async function regenerateRecoveryCodes(userId, token, req) {
  const user = await User.findById(userId).select("+mfaSecret +mfaRecoveryCodes");
  if (!user || !user.mfaEnabled) throw AppError.badRequest("Two-factor authentication is not on.");
  if (!(await checkSecondFactor(user, token))) throw new AppError("MFA_INVALID");
  const recoveryCodes = totp.generateRecoveryCodes(10);
  user.mfaRecoveryCodes = recoveryCodes.map((code) => ({ hash: totp.hashRecoveryCode(code), usedAt: null }));
  await user.save();
  await audit.record({ organizationId: user.lastOrganizationId || null, actorId: user._id, action: "auth.mfa_recovery_regenerated", entityType: "User", entityId: user._id, severity: "warning" }, req);
  return { recoveryCodes };
}

/**
 * Accept either a code from the app or an unused recovery code. A TOTP code
 * is accepted once: the matched counter is remembered so the same six digits
 * cannot be replayed inside the drift window.
 */
async function checkSecondFactor(user, token) {
  const clean = String(token || "").trim();
  const secret = decryptSecret(user);
  if (secret && /^\d{6}$/.test(clean.replace(/\s/g, ""))) {
    const result = totp.verify(secret, clean);
    if (result.valid && (user.mfaLastCounter === null || user.mfaLastCounter === undefined || result.counter > user.mfaLastCounter)) {
      user.mfaLastCounter = result.counter;
      await User.updateOne({ _id: user._id }, { $set: { mfaLastCounter: result.counter } });
      return true;
    }
    return false;
  }
  const hash = totp.hashRecoveryCode(clean);
  const codes = user.mfaRecoveryCodes || [];
  const match = codes.find((c) => c.hash === hash && !c.usedAt);
  if (!match) return false;
  match.usedAt = new Date();
  await User.updateOne({ _id: user._id, "mfaRecoveryCodes.hash": hash }, { $set: { "mfaRecoveryCodes.$.usedAt": match.usedAt } });
  logger.info({ userId: String(user._id) }, "A recovery code was used to sign in");
  return true;
}

/** The second step of sign-in: a valid MFA token from step one plus a code. */
async function verifyChallenge({ mfaToken, token }, req) {
  const payload = verifyMfaToken(mfaToken);
  const user = await User.findById(payload.sub).select("+mfaSecret +mfaRecoveryCodes +refreshTokens +mfaFailedAttempts");
  if (!user || !user.mfaEnabled) throw new AppError("MFA_INVALID");

  if ((user.mfaFailedAttempts || 0) >= 10) {
    throw new AppError("ACCOUNT_LOCKED", { message: "Too many incorrect codes. Sign in again with your password to retry." });
  }

  if (!(await checkSecondFactor(user, token))) {
    await User.updateOne({ _id: user._id }, { $inc: { mfaFailedAttempts: 1 } });
    throw new AppError("MFA_INVALID");
  }
  await User.updateOne({ _id: user._id }, { $set: { mfaFailedAttempts: 0 } });
  return { user, organizationId: payload.org };
}

/** What the security screen shows. */
async function status(userId) {
  const user = await User.findById(userId).select("+mfaRecoveryCodes").lean();
  if (!user) throw new AppError("UNAUTHENTICATED");
  const remaining = (user.mfaRecoveryCodes || []).filter((c) => !c.usedAt).length;
  let enforced = false;
  if (user.lastOrganizationId) {
    const policy = await policyFor(user.lastOrganizationId);
    if (policy.enforceTwoFactor) {
      const rbac = require("../rbac/rbac.service");
      const access = await tenant.runWithTenant(user.lastOrganizationId, () => rbac.resolveAccess(user.lastOrganizationId, String(user._id)));
      enforced = Boolean(access && isAdministrative(access.permissions));
    }
  }
  return {
    mfaEnabled: Boolean(user.mfaEnabled),
    mfaEnabledAt: user.mfaEnabledAt || null,
    recoveryCodesRemaining: user.mfaEnabled ? remaining : 0,
    enforced,
    passwordChangedAt: user.passwordChangedAt || null,
    lastLoginAt: user.lastLoginAt || null,
    lastLoginIp: user.lastLoginIp || null,
  };
}

// ── Sessions ────────────────────────────────────────────────────────────────

/** Every live session (refresh-token family) for the account, newest first. */
async function listSessions(userId, currentRefreshToken) {
  const user = await User.findById(userId).select("+refreshTokens").lean();
  if (!user) throw new AppError("UNAUTHENTICATED");
  const currentHash = currentRefreshToken ? tokens.hashRefreshToken(currentRefreshToken) : null;
  const now = Date.now();

  const families = new Map();
  for (const entry of user.refreshTokens || []) {
    if (entry.revokedAt || (entry.expiresAt && new Date(entry.expiresAt).getTime() < now)) continue;
    const existing = families.get(entry.family);
    if (!existing || new Date(entry.createdAt) > new Date(existing.createdAt)) families.set(entry.family, entry);
  }
  const { describeDevice } = require("./auth.service");
  return [...families.values()]
    .map((entry) => ({
      id: entry.family,
      device: describeDevice(entry.userAgent),
      userAgent: entry.userAgent || null,
      ip: entry.ip || null,
      createdAt: entry.createdAt,
      lastUsedAt: entry.lastUsedAt || entry.createdAt,
      expiresAt: entry.expiresAt || null,
      current: Boolean(currentHash && entry.tokenHash === currentHash),
    }))
    .sort((a, b) => (a.current ? -1 : b.current ? 1 : new Date(b.lastUsedAt) - new Date(a.lastUsedAt)));
}

/** End one session by family, or every session but this one. */
async function revokeSessions(userId, { family, exceptRefreshToken } = {}, req) {
  const user = await User.findById(userId).select("+refreshTokens");
  if (!user) throw new AppError("UNAUTHENTICATED");
  const keepHash = exceptRefreshToken ? tokens.hashRefreshToken(exceptRefreshToken) : null;
  const keepFamily = keepHash ? (user.refreshTokens.find((t) => t.tokenHash === keepHash) || {}).family : null;

  let revoked = 0;
  for (const entry of user.refreshTokens) {
    if (entry.revokedAt) continue;
    if (family && entry.family !== family) continue;
    if (!family && keepFamily && entry.family === keepFamily) continue;
    entry.revokedAt = new Date();
    revoked += 1;
  }
  await user.save();
  await audit.record(
    { organizationId: user.lastOrganizationId || null, actorId: user._id, action: family ? "auth.session_revoked" : "auth.other_sessions_revoked", entityType: "User", entityId: user._id, severity: "notice", after: { revoked } },
    req
  );
  return { revoked };
}

/** Admin: end every session of another user in this organization (offboarding, a lost laptop). */
async function revokeAllForUser(targetUserId, req) {
  const Membership = require("../rbac/membership.model");
  const member = await Membership.findOne({ userId: targetUserId }).lean();
  if (!member) throw AppError.notFound("User");
  const user = await User.findById(targetUserId).select("+refreshTokens");
  if (!user) throw AppError.notFound("User");
  let revoked = 0;
  for (const entry of user.refreshTokens) {
    if (!entry.revokedAt) {
      entry.revokedAt = new Date();
      revoked += 1;
    }
  }
  await user.save();
  await audit.record({ action: "auth.sessions_revoked_by_admin", entityType: "User", entityId: user._id, entityLabel: user.email, severity: "warning", after: { revoked } }, req);
  return { revoked };
}

/** Admin: reset another user's two-factor when they have lost their phone and their codes. */
async function resetMfaForUser(targetUserId, req) {
  const Membership = require("../rbac/membership.model");
  const member = await Membership.findOne({ userId: targetUserId }).lean();
  if (!member) throw AppError.notFound("User");
  const user = await User.findById(targetUserId).select("+mfaSecret +mfaRecoveryCodes +refreshTokens");
  if (!user) throw AppError.notFound("User");
  user.mfaEnabled = false;
  user.mfaSecret = null;
  user.mfaPendingSecret = null;
  user.mfaRecoveryCodes = [];
  user.mfaLastCounter = null;
  // Their sessions end too: whoever holds the phone that was "lost" is out.
  for (const entry of user.refreshTokens) if (!entry.revokedAt) entry.revokedAt = new Date();
  await user.save();
  await audit.record({ action: "auth.mfa_reset_by_admin", entityType: "User", entityId: user._id, entityLabel: user.email, severity: "critical", description: "Two-factor authentication removed by an administrator; all sessions ended" }, req);
  notifications
    .sendTransactional({
      to: user.email,
      template: "mfa_changed",
      organizationId: tenant.getOrganizationId(),
      data: { firstName: user.firstName, state: "reset by an administrator", when: new Date().toLocaleString("en-GB", { timeZone: user.timezone || "Asia/Kolkata" }), ip: (req && req.ip) || "unknown" },
    })
    .catch(() => {});
  return { ok: true };
}

/** Sign-in history for the account: the audit trail, filtered. */
async function loginHistory(userId, { limit = 20 } = {}) {
  const { AuditLog } = require("../../core/audit/audit.service");
  const rows = await AuditLog.find({ actorId: userId, action: { $in: ["auth.signed_in", "auth.account_locked", "auth.refresh_reuse_detected", "auth.mfa_enabled", "auth.mfa_disabled", "auth.password_changed", "auth.password_reset", "auth.session_revoked", "auth.other_sessions_revoked"] } })
    .setOptions({ bypassTenant: true })
    .sort({ occurredAt: -1 })
    .limit(limit)
    .lean()
    .catch(() => []);
  const { describeDevice } = require("./auth.service");
  return rows.map((r) => ({ id: String(r._id), action: r.action, at: r.occurredAt, ip: r.ip || null, device: describeDevice(r.userAgent), description: r.description || null }));
}

module.exports = {
  ADMIN_PERMISSIONS,
  isAdministrative,
  policyFor,
  assertIpAllowed,
  assertPasswordPolicy,
  passwordExpired,
  assertNotIdle,
  signMfaToken,
  verifyMfaToken,
  beginEnrolment,
  completeEnrolment,
  disable,
  regenerateRecoveryCodes,
  verifyChallenge,
  status,
  listSessions,
  revokeSessions,
  revokeAllForUser,
  resetMfaForUser,
  loginHistory,
  crypto,
};
