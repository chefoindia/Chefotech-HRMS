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

module.exports = router;
