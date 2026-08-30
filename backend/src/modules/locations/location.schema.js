"use strict";

const { z } = require("zod");
const { isValidTimezone } = require("../../shared/datetime");
const { objectId } = require("../../core/validation/common");

/**
 * The shapes the location endpoints accept.
 *
 * Lifted out of the routes file so the form registry can read them. That
 * registry derives every field's type, bounds and options from these
 * definitions rather than restating them, which only stays honest while
 * this file is the single place they are written down.
 */
const AddressSchema = z.object({
  line1: z.string().max(120).optional(),
  line2: z.string().max(120).optional(),
  city: z.string().max(60).optional(),
  state: z.string().max(60).optional(),
  country: z.string().max(60).optional(),
  postalCode: z.string().max(20).optional(),
});

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  code: z.string().trim().min(1).max(20),
  type: z
    .enum(["head_office", "branch", "factory", "warehouse", "site", "remote", "client_site"])
    .optional(),
  address: AddressSchema.optional(),
  timezone: z
    .string()
    .refine(isValidTimezone, "Not a recognised timezone")
    .nullable()
    .optional(),
  holidayCalendarId: objectId().nullable().optional(),
  geo: z
    .object({
      latitude: z.number().min(-90).max(90).nullable().optional(),
      longitude: z.number().min(-180).max(180).nullable().optional(),
      radiusMetres: z.number().int().min(20).max(5000).optional(),
    })
    .optional(),
  contactPerson: z.string().max(80).optional(),
  contactPhone: z.string().max(30).optional(),
  isActive: z.boolean().optional(),
});

const UpdateSchema = CreateSchema.partial();

module.exports = {
  AddressSchema,
  CreateSchema,
  UpdateSchema,
};
