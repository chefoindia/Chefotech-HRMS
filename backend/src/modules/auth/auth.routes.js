"use strict";

const express = require("express");
const controller = require("./auth.controller");
const schemas = require("./auth.schema");
const { validate } = require("../../core/validation/validate");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { authenticate } = require("./authenticate");
const { authLimiter, strictLimiter } = require("../../core/security/rateLimit");

const router = express.Router();

/**
 * Unauthenticated endpoints are rate limited per IP. Credential-stuffing a
 * multi-tenant HRMS is worth an attacker's time, so /login and the token
 * endpoints get the strictest bucket.
 */

router.post(
  "/register",
  strictLimiter,
  validate({ body: schemas.RegisterSchema }),
  asyncHandler(controller.register)
);

router.post(
  "/login",
  authLimiter,
  validate({ body: schemas.LoginSchema }),
  asyncHandler(controller.login)
);

/** Second step of sign-in when the account has two-factor on. */
router.post(
  "/mfa/verify",
  authLimiter,
  validate({ body: schemas.MfaVerifySchema }),
  asyncHandler(controller.mfaVerify)
);

router.post(
  "/refresh",
  authLimiter,
  validate({ body: schemas.RefreshSchema }),
  asyncHandler(controller.refresh)
);

router.post("/logout", authenticate({ optional: true }), asyncHandler(controller.logout));

router.post(
  "/forgot-password",
  strictLimiter,
  validate({ body: schemas.ForgotPasswordSchema }),
  asyncHandler(controller.forgotPassword)
);

router.post(
  "/reset-password",
  strictLimiter,
  validate({ body: schemas.ResetPasswordSchema }),
  asyncHandler(controller.resetPassword)
);

router.post(
  "/verify-email",
  authLimiter,
  validate({ body: schemas.VerifyEmailSchema }),
  asyncHandler(controller.verifyEmail)
);

router.post(
  "/accept-invitation",
  strictLimiter,
  validate({ body: schemas.AcceptInvitationSchema }),
  asyncHandler(controller.acceptInvitation)
);

// ── Authenticated ───────────────────────────────────────────────────────────

router.get("/me", authenticate(), asyncHandler(controller.me));

// A signed-in person whose address is still unconfirmed can ask for the
// confirmation email again. Rate limited like every other outbound-mail
// endpoint; works before an organization is chosen.
router.post(
  "/resend-verification",
  strictLimiter,
  authenticate({ allowNoOrganization: true }),
  asyncHandler(controller.resendVerification)
);

// Available between sign-in and choosing an organization, so it must not
// require a tenant context.
router.get(
  "/organizations",
  authenticate({ allowNoOrganization: true }),
  asyncHandler(controller.organizations)
);

router.post(
  "/switch-organization",
  authenticate({ allowNoOrganization: true }),
  validate({ body: schemas.SwitchOrganizationSchema }),
  asyncHandler(controller.switchOrganization)
);

router.post(
  "/change-password",
  authenticate(),
  validate({ body: schemas.ChangePasswordSchema }),
  asyncHandler(controller.changePassword)
);

// ── Account security: two-factor, sessions, history ─────────────────────────
// All of these work before an organization is chosen, because a person who
// has been told to set up two-factor must be able to do so from anywhere.

router.get("/security", authenticate({ allowNoOrganization: true }), asyncHandler(controller.securityStatus));

router.post("/mfa/setup", strictLimiter, authenticate({ allowNoOrganization: true }), asyncHandler(controller.mfaSetup));

router.post(
  "/mfa/enable",
  authLimiter,
  authenticate({ allowNoOrganization: true }),
  validate({ body: schemas.MfaEnableSchema }),
  asyncHandler(controller.mfaEnable)
);

router.post(
  "/mfa/disable",
  authLimiter,
  authenticate({ allowNoOrganization: true }),
  validate({ body: schemas.MfaDisableSchema }),
  asyncHandler(controller.mfaDisable)
);

router.post(
  "/mfa/recovery-codes",
  authLimiter,
  authenticate({ allowNoOrganization: true }),
  validate({ body: schemas.MfaEnableSchema }),
  asyncHandler(controller.mfaRecoveryCodes)
);

router.get("/sessions", authenticate({ allowNoOrganization: true }), asyncHandler(controller.sessions));
router.delete("/sessions/:family", authenticate({ allowNoOrganization: true }), asyncHandler(controller.revokeSession));
router.post("/sessions/revoke-others", authenticate({ allowNoOrganization: true }), asyncHandler(controller.revokeOtherSessions));
router.get("/login-history", authenticate({ allowNoOrganization: true }), asyncHandler(controller.loginHistory));

module.exports = router;
