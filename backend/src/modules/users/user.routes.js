"use strict";

const express = require("express");
const { z } = require("zod");
const service = require("./user.service");
const { authenticate } = require("../auth/authenticate");
const { requirePermission } = require("../../core/rbac/authorize");
const { validate } = require("../../core/validation/validate");
const { asyncHandler } = require("../../core/http/asyncHandler");
const { objectId, objectIdParam, email, listQuery, phone } = require("../../core/validation/common");
const { ok, created, paged } = require("../../core/http/response");
const organizationService = require("../organizations/organization.service");

const {
  InviteSchema,
  UpdateMembershipSchema,
  SelfUpdateSchema,
} = require("./user.schema");

const router = express.Router();
router.use(authenticate());

/** Own account. Needs no permission beyond being signed in. */
router.patch(
  "/me",
  validate({ body: SelfUpdateSchema }),
  asyncHandler(async (req, res) => ok(res, await service.updateOwnAccount(req.auth.userId, req.body, req)))
);

router.get(
  "/",
  requirePermission("user.view"),
  validate({ query: listQuery({ status: z.string().optional(), roleId: objectId().optional() }) }),
  asyncHandler(async (req, res) => {
    const result = await service.list(req.query);
    return paged(res, result.items, result);
  })
);

router.get(
  "/:id",
  requirePermission("user.view"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => ok(res, await service.getById(req.params.id)))
);

router.post(
  "/invite",
  requirePermission("user.invite"),
  validate({ body: InviteSchema }),
  asyncHandler(async (req, res) => {
    const result = await service.invite(req.body, req);
    await organizationService.markStepCompleteIfPending("invite_admins");
    return created(res, result);
  })
);

router.post(
  "/:id/resend-invitation",
  requirePermission("user.invite"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => ok(res, await service.resendInvitation(req.params.id, req)))
);

router.patch(
  "/:id",
  requirePermission("user.update"),
  validate({ params: objectIdParam(), body: UpdateMembershipSchema }),
  asyncHandler(async (req, res) => {
    // Changing roles is a separate, more sensitive capability than editing a
    // user's details, so it is guarded independently of user.update.
    if (req.body.roleIds && !req.auth.permissions.includes("role.assign")) {
      const { AppError } = require("../../core/errors/AppError");
      throw AppError.forbidden("You do not have permission to change roles.");
    }
    return ok(res, await service.updateMembership(req.params.id, req.body, req));
  })
);

router.delete(
  "/:id",
  requirePermission("user.deactivate"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => ok(res, await service.removeMembership(req.params.id, req)))
);

// ── Account security, done to someone else ──────────────────────────────────

/** End every session of a user: a lost laptop, a leaver, a suspected takeover. */
router.post(
  "/:id/revoke-sessions",
  requirePermission("user.update"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => {
    const security = require("../auth/security.service");
    return ok(res, await security.revokeAllForUser(req.params.id, req));
  })
);

/** Remove a user's second factor when they have lost both phone and codes. Ends their sessions too. */
router.post(
  "/:id/reset-mfa",
  requirePermission("settings.manage_security"),
  validate({ params: objectIdParam() }),
  asyncHandler(async (req, res) => {
    const security = require("../auth/security.service");
    return ok(res, await security.resetMfaForUser(req.params.id, req));
  })
);

module.exports = router;
