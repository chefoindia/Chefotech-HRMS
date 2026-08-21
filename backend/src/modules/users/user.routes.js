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

const InviteSchema = z.object({
  email: email(),
  firstName: z.string().trim().max(60).optional(),
  lastName: z.string().trim().max(60).optional(),
  roleIds: z.array(objectId()).min(1, "Choose at least one role").max(10),
  employeeId: objectId().nullable().optional(),
});

const UpdateMembershipSchema = z.object({
  roleIds: z.array(objectId()).min(1).max(10).optional(),
  status: z.enum(["active", "suspended", "removed"]).optional(),
  isManager: z.boolean().optional(),
  employeeId: objectId().nullable().optional(),
});

const SelfUpdateSchema = z.object({
  firstName: z.string().trim().min(1).max(60).optional(),
  lastName: z.string().trim().max(60).optional(),
  phone: phone().optional().or(z.literal("")),
  locale: z.string().max(10).optional(),
  timezone: z.string().max(60).nullable().optional(),
});

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

module.exports = router;
