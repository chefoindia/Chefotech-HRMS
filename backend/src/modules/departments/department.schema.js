"use strict";

const { z } = require("zod");
const { objectId } = require("../../core/validation/common");

/**
 * The shapes the department endpoints accept.
 *
 * Lifted out of the routes file so the form registry can read them. That
 * registry derives every field's type, bounds and options from these
 * definitions rather than restating them, which only stays honest while
 * this file is the single place they are written down.
 */
const CreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  code: z.string().trim().min(1).max(20),
  description: z.string().max(500).optional(),
  parentId: objectId().nullable().optional(),
  headEmployeeId: objectId().nullable().optional(),
  costCentre: z.string().max(40).optional(),
  isActive: z.boolean().optional(),
});

const UpdateSchema = CreateSchema.partial();

module.exports = {
  CreateSchema,
  UpdateSchema,
};
