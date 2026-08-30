"use strict";

const { z } = require("zod");
const { objectId, dateString } = require("../../core/validation/common");

/**
 * The shapes the leave endpoints accept.
 *
 * Lifted out of the routes file so the form registry can read them. That
 * registry derives every field's type, bounds and options from these
 * definitions rather than restating them, which only stays honest while
 * this file is the single place they are written down.
 */
const LeaveTypeSchema = z.object({
  name: z.string().trim().min(1).max(60),
  code: z.string().trim().min(1).max(20),
  description: z.string().max(300).optional(),
  colour: z.string().max(9).optional(),
  isPaid: z.boolean().optional(),
  hasBalance: z.boolean().optional(),
  isCompOff: z.boolean().optional(),
  isSpecial: z.boolean().optional(),
  unit: z.enum(["day", "hour"]).optional(),
  allowHalfDay: z.boolean().optional(),
  allowHourly: z.boolean().optional(),
  requiresAttachment: z.boolean().optional(),
  attachmentRequiredAfterDays: z.number().int().min(0).max(60).optional(),
  eligibility: z
    .object({
      genders: z.array(z.string()).optional(),
      employmentTypes: z.array(z.string()).optional(),
      departmentIds: z.array(objectId()).optional(),
      locationIds: z.array(objectId()).optional(),
      minimumServiceMonths: z.number().int().min(0).max(120).optional(),
      availableDuringProbation: z.boolean().optional(),
      availableDuringNotice: z.boolean().optional(),
    })
    .optional(),
  isActive: z.boolean().optional(),
  order: z.number().int().optional(),
});

const RuleSchema = z.object({
  leaveTypeId: objectId(),
  allocation: z
    .object({
      mode: z.enum(["annual", "monthly", "quarterly", "accrual", "unlimited", "none"]).optional(),
      daysPerPeriod: z.number().min(0).max(365).optional(),
      accrualPerMonth: z.number().min(0).max(31).optional(),
      creditTiming: z.enum(["advance", "arrears"]).optional(),
      prorateOnJoining: z.boolean().optional(),
      prorateOnExit: z.boolean().optional(),
      rounding: z.enum(["none", "up", "down", "nearest_half", "nearest_whole"]).optional(),
      maximumBalance: z.number().min(0).max(999).optional(),
    })
    .optional(),
  carryForward: z
    .object({
      enabled: z.boolean().optional(),
      maximumDays: z.number().min(0).max(365).optional(),
      expiryMonths: z.number().int().min(0).max(24).optional(),
    })
    .optional(),
  encashment: z
    .object({
      enabled: z.boolean().optional(),
      maximumDays: z.number().min(0).max(365).optional(),
      minimumBalanceToRetain: z.number().min(0).max(365).optional(),
      onExitOnly: z.boolean().optional(),
    })
    .optional(),
  application: z
    .object({
      minimumDaysPerRequest: z.number().min(0).max(30).optional(),
      maximumDaysPerRequest: z.number().min(0).max(365).optional(),
      maximumRequestsPerYear: z.number().int().min(0).max(365).optional(),
      noticeDays: z.number().int().min(0).max(90).optional(),
      allowBackdated: z.boolean().optional(),
      backdatedLimitDays: z.number().int().min(0).max(365).optional(),
      allowNegativeBalance: z.boolean().optional(),
      maximumNegativeDays: z.number().min(0).max(60).optional(),
      maximumConcurrentInTeam: z.number().int().min(0).max(100).optional(),
    })
    .optional(),
  counting: z
    .object({
      holidays: z.enum(["exclude", "include", "sandwich"]).optional(),
      weeklyOffs: z.enum(["exclude", "include", "sandwich"]).optional(),
    })
    .optional(),
  approval: z
    .object({
      required: z.boolean().optional(),
      escalateAfterDays: z.number().int().min(0).max(365).optional(),
      workflowId: objectId().nullable().optional(),
      autoApprove: z.boolean().optional(),
    })
    .optional(),
});

const LeavePolicySchema = z.object({
  name: z.string().trim().min(1).max(60),
  code: z.string().trim().min(1).max(20),
  description: z.string().max(300).optional(),
  rules: z.array(RuleSchema).max(40).optional(),
  yearStartMonth: z.number().int().min(1).max(12).nullable().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const ApplySchema = z.object({
  leaveTypeId: objectId(),
  fromDate: dateString(),
  toDate: dateString(),
  fromPortion: z.enum(["full", "first_half", "second_half"]).optional(),
  toPortion: z.enum(["full", "first_half", "second_half"]).optional(),
  reason: z.string().trim().min(3, "Give a reason for this leave").max(500),
  contactDuringLeave: z.string().max(120).optional(),
  handoverToEmployeeId: objectId().nullable().optional(),
  attachmentFileId: objectId().nullable().optional(),
});

module.exports = {
  LeaveTypeSchema,
  RuleSchema,
  LeavePolicySchema,
  ApplySchema,
};
