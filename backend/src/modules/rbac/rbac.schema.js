"use strict";

const { z } = require("zod");
const { ALL_PERMISSIONS } = require("../../core/rbac/permissions");

/**
 * The shapes the rbac endpoints accept.
 *
 * Lifted out of the routes file so the form registry can read them. That
 * registry derives every field's type, bounds and options from these
 * definitions rather than restating them, which only stays honest while
 * this file is the single place they are written down.
 */
const RoleSchema = z.object({
  name: z.string().trim().min(2).max(60),
  key: z.string().trim().max(40).optional(),
  description: z.string().max(300).optional(),
  permissions: z.array(z.string().max(60)).max(ALL_PERMISSIONS.length + 40),
  rank: z.number().int().min(1).max(100).optional(),
});

module.exports = {
  RoleSchema,
};
