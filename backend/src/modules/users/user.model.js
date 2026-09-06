"use strict";

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
const { createGlobalSchema } = require("../../core/tenancy/baseSchema");
const { env } = require("../../config/env");

/**
 * A person who can sign in.
 *
 * Global rather than tenant-scoped, on purpose: one human — a consulting HR
 * partner, an accountant, a founder with two companies — can belong to several
 * organizations with a different role in each. Identity is global; access is
 * per-organization and lives on Membership.
 *
 * A User is NOT an Employee. Most employees have a user account, but a
 * contractor being paid through payroll may have none, and an external
 * auditor may have a user account and no employee record.
 */
const userSchema = createGlobalSchema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true,
  },
  passwordHash: { type: String, default: null, select: false },

  firstName: { type: String, required: true, trim: true },
  lastName: { type: String, trim: true, default: "" },
  phone: { type: String, trim: true, default: "" },
  avatarFileId: { type: mongoose.Schema.Types.ObjectId, ref: "StoredFile", default: null },

  status: {
    type: String,
    enum: ["invited", "active", "disabled"],
    default: "invited",
    index: true,
  },
  emailVerifiedAt: { type: Date, default: null },

  // Chefotech staff. Platform users have no Membership and never appear in a
  // tenant's user list.
  isPlatformUser: { type: Boolean, default: false, index: true },
  platformRole: {
    type: String,
    enum: ["SUPER_ADMIN", "SYSTEM_ADMIN", "SUPPORT", null],
    default: null,
  },

  // The organization to land in after sign-in when the user belongs to several.
  lastOrganizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Organization",
    default: null,
  },

  locale: { type: String, default: "en-IN" },
  timezone: { type: String, default: null }, // falls back to the org's

  // ── Credentials and sign-in protection ──────────────────────────────────
  failedLoginAttempts: { type: Number, default: 0, select: false },
  lockedUntil: { type: Date, default: null, select: false },
  lastLoginAt: { type: Date, default: null },
  lastLoginIp: { type: String, default: null },
  passwordChangedAt: { type: Date, default: null },

  // Refresh tokens are stored hashed, never in the clear: a database leak
  // must not hand an attacker a set of working sessions.
  refreshTokens: {
    type: [
      {
        tokenHash: { type: String, required: true },
        family: { type: String, required: true },
        userAgent: String,
        ip: String,
        createdAt: { type: Date, default: Date.now },
        expiresAt: Date,
        revokedAt: { type: Date, default: null },
      },
    ],
    default: [],
    select: false,
  },

  // Single-use tokens, also stored hashed.
  passwordResetTokenHash: { type: String, default: null, select: false },
  passwordResetExpiresAt: { type: Date, default: null, select: false },
  emailVerifyTokenHash: { type: String, default: null, select: false },
  emailVerifyExpiresAt: { type: Date, default: null, select: false },
  invitationTokenHash: { type: String, default: null, select: false },
  invitationExpiresAt: { type: Date, default: null, select: false },

  // ── Two-factor authentication ──────────────────────────────────────────
  // The TOTP secret is stored encrypted (secretBox) and never selected by
  // default. A pending secret exists only between "show me the QR" and the
  // first correct code; recovery codes are stored hashed, one use each.
  mfaEnabled: { type: Boolean, default: false },
  mfaEnabledAt: { type: Date, default: null },
  mfaSecret: { type: String, default: null, select: false },
  mfaPendingSecret: { type: String, default: null, select: false },
  mfaRecoveryCodes: {
    type: [{ hash: { type: String, required: true }, usedAt: { type: Date, default: null } }],
    default: [],
    select: false,
  },
  // The last accepted TOTP step, so one code cannot be replayed inside the drift window.
  mfaLastCounter: { type: Number, default: null },
  mfaFailedAttempts: { type: Number, default: 0, select: false },

  deletedAt: { type: Date, default: null },
});

userSchema.index({ isPlatformUser: 1, status: 1 });

userSchema.virtual("fullName").get(function fullName() {
  return [this.firstName, this.lastName].filter(Boolean).join(" ");
});

userSchema.methods.setPassword = async function setPassword(plain) {
  this.passwordHash = await bcrypt.hash(plain, env.security.bcryptRounds);
  this.passwordChangedAt = new Date();
  // Changing a password ends every other session. That is the point of it.
  this.refreshTokens = [];
  this.failedLoginAttempts = 0;
  this.lockedUntil = null;
};

userSchema.methods.verifyPassword = async function verifyPassword(plain) {
  if (!this.passwordHash) return false;
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.methods.isLocked = function isLocked() {
  return Boolean(this.lockedUntil && this.lockedUntil > new Date());
};

/** Opaque single-use token: the plain half is emailed, the hash is stored. */
userSchema.statics.generateToken = function generateToken() {
  const plain = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(plain).digest("hex");
  return { plain, hash };
};

userSchema.statics.hashToken = function hashToken(plain) {
  return crypto.createHash("sha256").update(String(plain)).digest("hex");
};

module.exports = mongoose.model("User", userSchema);
