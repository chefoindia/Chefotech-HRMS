"use strict";

const { z } = require("zod");
const { objectId, dateString } = require("../../core/validation/common");

/**
 * The shapes the holiday endpoints accept.
 *
 * Lifted out of the routes file so the form registry can read them. That
 * registry derives every field's type, bounds and options from these
 * definitions rather than restating them, which only stays honest while
 * this file is the single place they are written down.
 */
const CalendarSchema = z.object({
  name: z.string().trim().min(1).max(60),
  code: z.string().trim().min(1).max(20),
  year: z.number().int().min(2000).max(2100),
  description: z.string().max(300).optional(),
  locationIds: z.array(objectId()).optional(),
  optionalHolidayQuota: z.number().int().min(0).max(20).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const HolidaySchema = z.object({
  calendarId: objectId(),
  name: z.string().trim().min(1).max(80),
  date: dateString(),
  type: z.enum(["public", "national", "regional", "company", "optional", "restricted"]).optional(),
  description: z.string().max(300).optional(),
  isHalfDay: z.enum(["", "first", "second"]).optional(),
  isOptional: z.boolean().optional(),
  isPaid: z.boolean().optional(),
  colour: z.string().max(9).optional(),
});

module.exports = {
  CalendarSchema,
  HolidaySchema,
};
