"use strict";

const { z } = require("zod");
const { objectId, timeString, dateString } = require("../../core/validation/common");

/**
 * The shapes the shift endpoints accept.
 *
 * Lifted out of shift.routes.js so they have one name that other parts of the
 * platform can refer to. The form registry reads these to work out what every
 * shift input is called, what it accepts and whether it is required — which
 * only stays true while this file is the single definition. Re-stating a
 * field's type anywhere else would let the two drift, and the drift would
 * surface as the AI proposing a value the endpoint then rejects.
 */

const ShiftSchema = z.object({
  name: z.string().trim().min(1).max(60),
  code: z.string().trim().min(1).max(20),
  description: z.string().max(300).optional(),
  type: z.enum(["fixed", "flexible", "rotational"]).optional(),
  startTime: timeString(),
  endTime: timeString(),
  breakMinutes: z.number().int().min(0).max(480).optional(),
  isBreakPaid: z.boolean().optional(),
  flexibleMinimumMinutes: z.number().int().min(60).max(1440).optional(),
  coreStartTime: timeString().nullable().optional(),
  coreEndTime: timeString().nullable().optional(),
  colour: z.string().max(9).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const WeeklyOffSchema = z.object({
  name: z.string().trim().min(1).max(60),
  code: z.string().trim().min(1).max(20),
  description: z.string().max(300).optional(),
  days: z
    .array(
      z.object({
        day: z.number().int().min(0).max(6),
        type: z.enum(["working", "off", "half_day", "alternate"]),
        offOccurrences: z.array(z.number().int().min(1).max(5)).optional(),
        halfDaySession: z.enum(["first", "second"]).optional(),
      })
    )
    .length(7, "Provide a rule for all seven days"),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const PatternDaySchema = z.object({
  day: z.number().int().min(0).max(6).optional(),
  position: z.number().int().min(0).max(365).optional(),
  shiftId: objectId().nullable().optional(),
});

const PatternSchema = z.object({
  name: z.string().trim().min(1).max(60),
  code: z.string().trim().min(1).max(20),
  description: z.string().max(300).optional(),
  type: z.enum(["weekly", "rotating"]).optional(),
  days: z.array(PatternDaySchema).max(7).optional(),
  cycle: z.array(PatternDaySchema).max(366).optional(),
  anchorDate: dateString().nullable().optional(),
  colour: z.string().max(9).optional(),
  isActive: z.boolean().optional(),
});

const AssignSchema = z.object({
  employeeIds: z.array(objectId()).min(1).max(500),
  shiftId: objectId(),
  fromDate: dateString(),
  toDate: dateString(),
  reason: z.string().max(200).optional(),
});

module.exports = {
  ShiftSchema,
  WeeklyOffSchema,
  PatternDaySchema,
  PatternSchema,
  AssignSchema,
};
