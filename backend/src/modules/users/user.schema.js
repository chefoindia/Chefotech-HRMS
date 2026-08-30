"use strict";

const { z } = require("zod");
const { objectId, email, phone } = require("../../core/validation/common");

/**
 * The shapes the user endpoints accept.
 *
 * Lifted out of the routes file so the form registry can read them. That
 * registry derives every field's type, bounds and options from these
 * definitions rather than restating them, which only stays honest while
 * this file is the single place they are written down.
 */
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

module.exports = {
  InviteSchema,
  UpdateMembershipSchema,
  SelfUpdateSchema,
};
