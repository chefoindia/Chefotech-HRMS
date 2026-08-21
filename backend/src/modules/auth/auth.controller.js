"use strict";

const service = require("./auth.service");
const tokens = require("./tokens");
const { ok, created } = require("../../core/http/response");

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
  tokens.setAuthCookies(res, result);
  return ok(res, result);
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
  await service.forgotPassword(req.body.email, req);
  return ok(res, {
    message: "If an account exists for that address, a reset link is on its way.",
  });
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
  refresh,
  logout,
  me,
  organizations,
  switchOrganization,
  forgotPassword,
  resetPassword,
  changePassword,
  verifyEmail,
  acceptInvitation,
};
