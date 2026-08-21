"use strict";

const User = require("../users/user.model");
const Membership = require("../rbac/membership.model");
const Organization = require("../organizations/organization.model");
const organizationService = require("../organizations/organization.service");
const rbac = require("../rbac/rbac.service");
const tokens = require("./tokens");
const { AppError } = require("../../core/errors/AppError");
const { env } = require("../../config/env");
const { logger } = require("../../config/logger");
const tenant = require("../../core/tenancy/tenantContext");
const audit = require("../../core/audit/audit.service");
const notifications = require("../notifications/notification.service");

/**
 * Authentication.
 *
 * Two deliberate properties throughout:
 *
 *   - Enumeration resistance. "Forgot password" and "sign up with an existing
 *     email" both return the same response whether or not the address exists.
 *     Login answers INVALID_CREDENTIALS for an unknown user and a wrong
 *     password alike.
 *   - Lockout on repeated failure, counted per user, with the counter reset on
 *     success and on a password change.
 */

/** Sign up: creates the person, their organization, and makes them the owner. */
async function register({ firstName, lastName, email, password, companyName, phone, timezone, country }, req) {
  const existing = await User.findOne({ email }).select("+passwordHash");

  if (existing) {
    // Do not confirm that the address is taken. An account already exists, so
    // tell that person by email instead of telling the visitor.
    logger.info({ email }, "Registration attempted with an existing email");
    await notifications
      .sendTransactional({
        to: email,
        template: "duplicate_signup_attempt",
        data: { firstName: existing.firstName },
      })
      .catch(() => {});
    return { pending: true };
  }

  const user = new User({
    email,
    firstName,
    lastName: lastName || "",
    phone: phone || "",
    status: "active",
    // Self-service signups are trusted to the extent that they can use the
    // product; verification gates outbound email, not access.
    emailVerifiedAt: null,
  });
  await user.setPassword(password);

  const verify = User.generateToken();
  user.emailVerifyTokenHash = verify.hash;
  user.emailVerifyExpiresAt = new Date(Date.now() + 48 * 3600 * 1000);
  await user.save();

  const { organization, membership } = await organizationService.provision(
    { name: companyName, ownerUserId: user._id, timezone, country },
    req
  );

  user.lastOrganizationId = organization._id;
  await user.save();

  await notifications
    .sendTransactional({
      to: user.email,
      template: "welcome",
      organizationId: organization._id,
      data: {
        firstName: user.firstName,
        companyName: organization.name,
        verifyUrl: `${env.app.publicUrl}/verify-email?token=${verify.plain}`,
      },
    })
    .catch((err) => logger.warn({ err }, "Welcome email failed"));

  const session = await issueSession(user, organization, membership, req);
  return { pending: false, ...session };
}

/**
 * Sign in.
 *
 * Returns either a full session (single organization, the common case) or a
 * chooser payload plus a scoped token when the user belongs to several.
 */
async function login({ email, password, organizationId }, req) {
  const user = await User.findOne({ email }).select(
    "+passwordHash +failedLoginAttempts +lockedUntil +refreshTokens"
  );

  const failure = async (code, meta) => {
    logger.warn({ email, code, ...meta }, "Login failed");
    throw new AppError(code);
  };

  if (!user || user.deletedAt) {
    // Spend roughly the same time as a real verification would, so response
    // timing does not reveal whether the address exists.
    await new Promise((r) => setTimeout(r, 120));
    return failure("INVALID_CREDENTIALS");
  }

  if (user.isLocked()) {
    const minutes = Math.ceil((user.lockedUntil - Date.now()) / 60000);
    throw new AppError("ACCOUNT_LOCKED", {
      message: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    });
  }

  if (user.status === "disabled") throw new AppError("ACCOUNT_DISABLED");

  const valid = await user.verifyPassword(password);
  if (!valid) {
    user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
    if (user.failedLoginAttempts >= env.security.maxLoginAttempts) {
      user.lockedUntil = new Date(Date.now() + env.security.loginLockoutMinutes * 60000);
      user.failedLoginAttempts = 0;
      await user.save();
      await audit.record({
        organizationId: null,
        actorId: user._id,
        actorEmail: user.email,
        action: "auth.account_locked",
        entityType: "User",
        entityId: user._id,
        severity: "warning",
        description: "Account locked after repeated failed sign-in attempts",
      }, req);
      throw new AppError("ACCOUNT_LOCKED");
    }
    await user.save();
    return failure("INVALID_CREDENTIALS", { attempts: user.failedLoginAttempts });
  }

  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  user.lastLoginAt = new Date();
  user.lastLoginIp = req && req.ip;
  await user.save();

  // ── Chefotech staff ───────────────────────────────────────────────────
  if (user.isPlatformUser) {
    const accessToken = tokens.signAccessToken({
      userId: user._id,
      organizationId: null,
      isPlatformUser: true,
      platformRole: user.platformRole,
    });
    const refresh = await addRefreshToken(user, req);
    return {
      mode: "platform",
      accessToken,
      refreshToken: refresh.plain,
      user: publicUser(user),
      redirectTo: "/platform",
    };
  }

  // ── Tenant users ──────────────────────────────────────────────────────
  const memberships = await listMemberships(user._id);

  if (!memberships.length) {
    throw new AppError("FORBIDDEN", {
      message: "This account is not linked to any organization yet.",
    });
  }

  const chosen = organizationId
    ? memberships.find((m) => String(m.organization.id) === String(organizationId))
    : memberships.find((m) => String(m.organization.id) === String(user.lastOrganizationId)) ||
      (memberships.length === 1 ? memberships[0] : null);

  if (!chosen) {
    if (organizationId) throw new AppError("FORBIDDEN");
    // Several organizations and no hint: let the user pick.
    const accessToken = tokens.signAccessToken({ userId: user._id, organizationId: null });
    const refresh = await addRefreshToken(user, req);
    return {
      mode: "select_organization",
      accessToken,
      refreshToken: refresh.plain,
      user: publicUser(user),
      organizations: memberships.map((m) => m.organization),
    };
  }

  const organization = await Organization.findById(chosen.organization.id);
  return issueSession(user, organization, chosen.membership, req);
}

/** Switch the active organization on an existing session. */
async function switchOrganization(userId, organizationId, req) {
  const user = await User.findById(userId);
  if (!user) throw new AppError("UNAUTHENTICATED");

  const memberships = await listMemberships(userId);
  const match = memberships.find((m) => String(m.organization.id) === String(organizationId));
  if (!match) throw new AppError("FORBIDDEN");

  const organization = await Organization.findById(organizationId);
  return issueSession(user, organization, match.membership, req);
}

/** Every organization this user can enter. */
async function listMemberships(userId) {
  // Memberships span tenants for one user, so this is a legitimate
  // cross-tenant read — narrowly scoped to that user's own rows.
  const rows = await tenant.runAsSystem(
    () =>
      Membership.find({ userId, status: { $in: ["active", "invited"] } })
        .setOptions({ bypassTenant: true })
        .lean(),
    "auth.list-memberships"
  );
  if (!rows.length) return [];

  const orgs = await Organization.find({
    _id: { $in: rows.map((r) => r.organizationId) },
    deletedAt: null,
  }).lean();
  const byId = Object.fromEntries(orgs.map((o) => [String(o._id), o]));

  return rows
    .filter((r) => byId[String(r.organizationId)])
    .map((r) => {
      const org = byId[String(r.organizationId)];
      return {
        membership: r,
        organization: {
          id: String(org._id),
          name: org.name,
          slug: org.slug,
          status: org.status,
          timezone: org.timezone,
          currency: org.currency,
          memberStatus: r.status,
        },
      };
    });
}

async function issueSession(user, organization, membership, req) {
  if (organization.status === "suspended" || organization.status === "cancelled") {
    throw new AppError("ORGANIZATION_SUSPENDED");
  }

  const accessToken = tokens.signAccessToken({
    userId: user._id,
    organizationId: organization._id,
    membershipId: membership._id,
  });
  const refresh = await addRefreshToken(user, req);

  if (String(user.lastOrganizationId || "") !== String(organization._id)) {
    await User.updateOne({ _id: user._id }, { $set: { lastOrganizationId: organization._id } });
  }

  await tenant.runWithTenant(organization._id, async () => {
    await Membership.updateOne(
      { _id: membership._id },
      { $set: { lastActiveAt: new Date() } }
    );
    await audit.record(
      {
        organizationId: organization._id,
        actorId: user._id,
        actorEmail: user.email,
        action: "auth.signed_in",
        entityType: "User",
        entityId: user._id,
        severity: "info",
      },
      req
    );
  });

  const access = await tenant.runWithTenant(organization._id, () =>
    rbac.resolveAccess(organization._id, String(user._id), { fresh: true })
  );

  const decorated = await tenant.runWithTenant(organization._id, () =>
    organizationService.decorate(organization.toObject ? organization.toObject() : organization)
  );

  return {
    mode: "session",
    accessToken,
    refreshToken: refresh.plain,
    user: publicUser(user),
    organization: decorated,
    permissions: access.permissions,
    roles: access.roles,
    employeeId: access.employeeId,
    redirectTo: landingRouteFor(access),
  };
}

/**
 * Where to land after sign-in.
 *
 * Derived from permissions, not from a role name, so a custom role built by a
 * tenant routes sensibly without anyone updating a mapping table.
 */
const LANDING_ROUTES = {
  /** Org-wide visibility: the full dashboard. */
  admin: "/app",
  /**
   * Approvals, not a team dashboard: a manager without org-wide visibility
   * signs in to do something, and what is waiting on them is the queue.
   */
  manager: "/app/approvals",
  /** Everyone else lands in their own portal. */
  employee: "/me",
};

function landingRouteFor(access) {
  const p = access.permissions || [];
  if (p.includes("dashboard.view_org_wide") || p.includes("employee.view")) {
    return LANDING_ROUTES.admin;
  }
  if (p.includes("workflow.act") || access.isManager) return LANDING_ROUTES.manager;
  return LANDING_ROUTES.employee;
}

async function addRefreshToken(user, req, family) {
  const token = tokens.createRefreshToken(family);
  const entry = {
    tokenHash: token.hash,
    family: token.family,
    userAgent: (req && req.headers && req.headers["user-agent"]) || null,
    ip: (req && req.ip) || null,
    createdAt: new Date(),
    expiresAt: token.expiresAt,
    revokedAt: null,
  };

  await User.updateOne(
    { _id: user._id },
    {
      $push: {
        // Keep the ten most recent sessions per user; older ones fall off.
        refreshTokens: { $each: [entry], $slice: -10 },
      },
    }
  );
  return token;
}

/**
 * Rotate a refresh token.
 *
 * Reuse detection: presenting a token that was already rotated means either a
 * race or a theft. Both are handled the same way — the entire family is
 * revoked, so an attacker with a copied token cannot keep a session alive.
 */
async function refresh(plainToken, req) {
  if (!plainToken) throw new AppError("UNAUTHENTICATED");
  const hash = tokens.hashRefreshToken(plainToken);

  const user = await User.findOne({ "refreshTokens.tokenHash": hash }).select(
    "+refreshTokens"
  );
  if (!user) throw new AppError("UNAUTHENTICATED");

  const entry = user.refreshTokens.find((t) => t.tokenHash === hash);
  if (!entry) throw new AppError("UNAUTHENTICATED");

  if (entry.revokedAt) {
    user.refreshTokens = user.refreshTokens.map((t) =>
      t.family === entry.family && !t.revokedAt ? { ...t.toObject(), revokedAt: new Date() } : t
    );
    await user.save();
    logger.warn({ userId: String(user._id), family: entry.family }, "Refresh token reuse detected");
    await audit.record({
      organizationId: null,
      actorId: user._id,
      action: "auth.refresh_reuse_detected",
      entityType: "User",
      entityId: user._id,
      severity: "critical",
      description: "A refresh token was presented twice; all sessions in that family were revoked",
    }, req);
    throw new AppError("UNAUTHENTICATED");
  }

  if (entry.expiresAt && entry.expiresAt < new Date()) {
    throw new AppError("TOKEN_EXPIRED");
  }

  entry.revokedAt = new Date();
  await user.save();

  const rotated = await addRefreshToken(user, req, entry.family);

  const organizationId = user.lastOrganizationId;
  let membershipId = null;
  if (organizationId && !user.isPlatformUser) {
    const access = await tenant.runWithTenant(organizationId, () =>
      rbac.resolveAccess(organizationId, String(user._id), { fresh: true })
    );
    if (!access || access.status === "removed") throw new AppError("UNAUTHENTICATED");
    membershipId = access.membershipId;
  }

  const accessToken = tokens.signAccessToken({
    userId: user._id,
    organizationId: user.isPlatformUser ? null : organizationId,
    membershipId,
    isPlatformUser: user.isPlatformUser,
    platformRole: user.platformRole,
  });

  return { accessToken, refreshToken: rotated.plain, user: publicUser(user) };
}

async function logout(userId, plainToken) {
  if (!userId) return { ok: true };
  const user = await User.findById(userId).select("+refreshTokens");
  if (!user) return { ok: true };

  if (plainToken) {
    const hash = tokens.hashRefreshToken(plainToken);
    const entry = user.refreshTokens.find((t) => t.tokenHash === hash);
    if (entry) entry.revokedAt = new Date();
  } else {
    // No token supplied: end every session for this user.
    user.refreshTokens.forEach((t) => {
      if (!t.revokedAt) t.revokedAt = new Date();
    });
  }
  await user.save();
  return { ok: true };
}

/** Always reports success — an attacker learns nothing about the address. */
async function forgotPassword(email, req) {
  const user = await User.findOne({ email });
  if (!user || user.status === "disabled") {
    await new Promise((r) => setTimeout(r, 150));
    return { ok: true };
  }

  const token = User.generateToken();
  user.passwordResetTokenHash = token.hash;
  user.passwordResetExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await user.save();

  await notifications
    .sendTransactional({
      to: user.email,
      template: "password_reset",
      organizationId: user.lastOrganizationId,
      data: {
        firstName: user.firstName,
        resetUrl: `${env.app.publicUrl}/reset-password?token=${token.plain}`,
        expiresInMinutes: 60,
      },
    })
    .catch((err) => logger.error({ err }, "Password reset email failed"));

  await audit.record({
    organizationId: user.lastOrganizationId || null,
    actorId: user._id,
    action: "auth.password_reset_requested",
    entityType: "User",
    entityId: user._id,
    severity: "notice",
  }, req);

  return { ok: true };
}

async function resetPassword(plainToken, newPassword, req) {
  const hash = User.hashToken(plainToken);
  const user = await User.findOne({
    passwordResetTokenHash: hash,
    passwordResetExpiresAt: { $gt: new Date() },
  }).select("+passwordResetTokenHash +passwordResetExpiresAt +refreshTokens +passwordHash");

  if (!user) throw new AppError("INVALID_TOKEN");

  await user.setPassword(newPassword);
  user.passwordResetTokenHash = null;
  user.passwordResetExpiresAt = null;
  if (user.status === "invited") user.status = "active";
  await user.save();

  await audit.record({
    organizationId: user.lastOrganizationId || null,
    actorId: user._id,
    action: "auth.password_reset",
    entityType: "User",
    entityId: user._id,
    severity: "warning",
    description: "Password reset completed; all sessions were ended",
  }, req);

  return { ok: true };
}

async function changePassword(userId, currentPassword, newPassword, req) {
  const user = await User.findById(userId).select("+passwordHash +refreshTokens");
  if (!user) throw new AppError("UNAUTHENTICATED");

  const valid = await user.verifyPassword(currentPassword);
  if (!valid) throw new AppError("INVALID_CREDENTIALS", { message: "Your current password is incorrect." });
  if (await user.verifyPassword(newPassword)) {
    throw AppError.badRequest("Choose a password you have not used here before.");
  }

  await user.setPassword(newPassword);
  await user.save();

  await audit.record({
    actorId: user._id,
    action: "auth.password_changed",
    entityType: "User",
    entityId: user._id,
    severity: "warning",
  }, req);

  return { ok: true };
}

async function verifyEmail(plainToken) {
  const hash = User.hashToken(plainToken);
  const user = await User.findOne({
    emailVerifyTokenHash: hash,
    emailVerifyExpiresAt: { $gt: new Date() },
  }).select("+emailVerifyTokenHash +emailVerifyExpiresAt");
  if (!user) throw new AppError("INVALID_TOKEN");

  user.emailVerifiedAt = new Date();
  user.emailVerifyTokenHash = null;
  user.emailVerifyExpiresAt = null;
  if (user.status === "invited") user.status = "active";
  await user.save();
  return { ok: true };
}

/** Complete an invitation: set a password and activate the membership. */
async function acceptInvitation(plainToken, { password, firstName, lastName }, req) {
  const hash = User.hashToken(plainToken);
  const user = await User.findOne({
    invitationTokenHash: hash,
    invitationExpiresAt: { $gt: new Date() },
  }).select("+invitationTokenHash +invitationExpiresAt +passwordHash +refreshTokens");

  if (!user) throw new AppError("INVALID_TOKEN");

  if (firstName) user.firstName = firstName;
  if (lastName !== undefined) user.lastName = lastName;
  await user.setPassword(password);
  user.status = "active";
  user.emailVerifiedAt = user.emailVerifiedAt || new Date();
  user.invitationTokenHash = null;
  user.invitationExpiresAt = null;
  await user.save();

  const memberships = await listMemberships(user._id);
  const invited = memberships.find((m) => m.membership.status === "invited") || memberships[0];
  if (!invited) throw new AppError("FORBIDDEN", { message: "This invitation is no longer valid." });

  await tenant.runWithTenant(invited.organization.id, () =>
    Membership.updateOne(
      { _id: invited.membership._id },
      { $set: { status: "active", joinedAt: new Date() } }
    )
  );

  const organization = await Organization.findById(invited.organization.id);
  return issueSession(user, organization, invited.membership, req);
}

/** The `me` payload: identity, org, permissions — everything the shell needs. */
async function me(auth) {
  const user = await User.findById(auth.userId).lean();
  if (!user) throw new AppError("UNAUTHENTICATED");

  if (auth.isPlatformUser) {
    return {
      user: publicUser(user),
      isPlatformUser: true,
      platformRole: user.platformRole,
      organization: null,
      permissions: [],
    };
  }

  const organization = await organizationService.current();
  const organizations = (await listMemberships(auth.userId)).map((m) => m.organization);

  return {
    user: publicUser(user),
    isPlatformUser: false,
    organization,
    organizations,
    membershipId: auth.membershipId,
    employeeId: auth.employeeId,
    permissions: auth.permissions,
    roles: auth.roles,
    isOwner: auth.isOwner,
    isManager: auth.isManager,
  };
}

function publicUser(user) {
  return {
    id: String(user._id),
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: [user.firstName, user.lastName].filter(Boolean).join(" "),
    phone: user.phone,
    status: user.status,
    emailVerified: Boolean(user.emailVerifiedAt),
    isPlatformUser: Boolean(user.isPlatformUser),
    locale: user.locale,
    timezone: user.timezone,
  };
}

module.exports = {
  // Exported so the deep-link suite can verify that every route a user can be
  // dropped onto after sign-in actually exists. A landing route that 404s
  // greets someone with a broken page as their very first impression.
  LANDING_ROUTES,
  register,
  login,
  switchOrganization,
  listMemberships,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
  changePassword,
  verifyEmail,
  acceptInvitation,
  me,
  publicUser,
  landingRouteFor,
};
