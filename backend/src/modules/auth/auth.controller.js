"use strict";

const service = require("./auth.service");
const security = require("./security.service");
const tokens = require("./tokens");
const { ok, created } = require("../../core/http/response");
const { env } = require("../../config/env");
const { AppError } = require("../../core/errors/AppError");

/**
 * Auth endpoints.
 *
 * Every response that establishes a session does two things: sets httpOnly
 * cookies AND returns the tokens in the body. See tokens.js for why both are
 * needed — it is not redundancy, it is the two deployment shapes.
 */

async function register(req, res) {
  const result = await service.register(req.body, req);

  if (result.pending) {
    // Deliberately indistinguishable from a real signup.
    return created(res, {
      pending: true,
      message: "Check your email to continue setting up your workspace.",
    });
  }

  tokens.setAuthCookies(res, result);
  return created(res, result);
}

async function login(req, res) {
  const result = await service.login(req.body, req);
  // An MFA challenge carries no session tokens; setAuthCookies is a no-op for it.
  tokens.setAuthCookies(res, result);
  return ok(res, result);
}

async function mfaVerify(req, res) {
  const result = await service.completeMfa(req.body, req);
  tokens.setAuthCookies(res, result);
  return ok(res, result);
}

async function securityStatus(req, res) {
  return ok(res, await security.status(req.auth.userId));
}

async function mfaSetup(req, res) {
  return ok(res, await security.beginEnrolment(req.auth.userId));
}

async function mfaEnable(req, res) {
  return ok(res, await security.completeEnrolment(req.auth.userId, req.body.token, req));
}

async function mfaDisable(req, res) {
  return ok(res, await security.disable(req.auth.userId, req.body, req));
}

async function mfaRecoveryCodes(req, res) {
  return ok(res, await security.regenerateRecoveryCodes(req.auth.userId, req.body.token, req));
}

async function sessions(req, res) {
  return ok(res, await security.listSessions(req.auth.userId, tokens.extractRefreshToken(req)));
}

async function revokeSession(req, res) {
  return ok(res, await security.revokeSessions(req.auth.userId, { family: req.params.family }, req));
}

async function revokeOtherSessions(req, res) {
  return ok(res, await security.revokeSessions(req.auth.userId, { exceptRefreshToken: tokens.extractRefreshToken(req) }, req));
}

async function loginHistory(req, res) {
  return ok(res, await security.loginHistory(req.auth.userId));
}

async function refresh(req, res) {
  const supplied = tokens.extractRefreshToken(req);
  const result = await service.refresh(supplied, req);
  tokens.setAuthCookies(res, result);
  return ok(res, result);
}

async function logout(req, res) {
  await service.logout(req.auth && req.auth.userId, tokens.extractRefreshToken(req));
  tokens.clearAuthCookies(res);
  return ok(res, { ok: true });
}

async function me(req, res) {
  return ok(res, await service.me(req.auth));
}

async function organizations(req, res) {
  const memberships = await service.listMemberships(req.auth.userId);
  return ok(res, memberships.map((m) => m.organization));
}

async function switchOrganization(req, res) {
  const result = await service.switchOrganization(
    req.auth.userId,
    req.body.organizationId,
    req
  );
  tokens.setAuthCookies(res, result);
  return ok(res, result);
}

async function forgotPassword(req, res) {
  // Honest without being an oracle: this check does not depend on whether
  // the address exists, so it reveals nothing about any account — only that
  // the server cannot send mail at all, which the person needs to hear
  // instead of waiting for an email that will never arrive.
  if (env.isProd && !env.mail.enabled) {
    throw new AppError("MAIL_ERROR", {
      message:
        "Password reset emails are switched off on this server. Ask your administrator to enable email.",
    });
  }

  const result = await service.forgotPassword(req.body.email, req);
  return ok(res, {
    message: "If an account exists for that address, a reset link is on its way.",
    // Development only, and only while mail is off: the link that would
    // have been emailed, so the flow can be walked through end to end.
    ...(result && result.devResetUrl ? { devResetUrl: result.devResetUrl } : {}),
  });
}

async function resendVerification(req, res) {
  return ok(res, await service.resendVerification(req.auth.userId, req));
}

async function resetPassword(req, res) {
  await service.resetPassword(req.body.token, req.body.password, req);
  return ok(res, { message: "Your password has been changed. Please sign in." });
}

async function changePassword(req, res) {
  await service.changePassword(
    req.auth.userId,
    req.body.currentPassword,
    req.body.newPassword,
    req
  );
  tokens.clearAuthCookies(res);
  return ok(res, { message: "Password changed. Please sign in again." });
}

async function verifyEmail(req, res) {
  await service.verifyEmail(req.body.token);
  return ok(res, { message: "Email verified." });
}

async function acceptInvitation(req, res) {
  const result = await service.acceptInvitation(req.body.token, req.body, req);
  tokens.setAuthCookies(res, result);
  return ok(res, result);
}

module.exports = {
  register,
  login,
  mfaVerify,
  securityStatus,
  mfaSetup,
  mfaEnable,
  mfaDisable,
  mfaRecoveryCodes,
  sessions,
  revokeSession,
  revokeOtherSessions,
  loginHistory,
  refresh,
  logout,
  me,
  organizations,
  switchOrganization,
  forgotPassword,
  resetPassword,
  changePassword,
  verifyEmail,
  resendVerification,
  acceptInvitation,
};
