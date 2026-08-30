"use strict";

const { z } = require("zod");
const { objectId } = require("../../core/validation/common");

/**
 * The shapes the payroll endpoints accept.
 *
 * Lifted out of the routes file so the form registry can read them. That
 * registry derives every field's type, bounds and options from these
 * definitions rather than restating them, which only stays honest while
 * this file is the single place they are written down.
 */
const ComponentSchema = z.object({
  name: z.string().trim().min(1).max(60),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9_]{0,29}$/, "Use uppercase letters, numbers and underscores"),
  description: z.string().max(300).optional(),
  type: z.enum(["earning", "deduction", "employer_contribution", "reimbursement", "informational"]),
  category: z
    .enum(["basic", "allowance", "bonus", "overtime", "arrear", "incentive", "statutory", "tax", "loan", "advance", "attendance", "other"])
    .optional(),
  calculation: z
    .object({
      method: z.enum(["fixed", "percentage", "formula", "attendance_based", "manual"]).optional(),
      amount: z.number().min(0).optional(),
      percentage: z.number().min(0).max(1000).optional(),
      ofComponent: z.string().max(30).optional(),
      expression: z.string().max(1000).optional(),
      minAmount: z.number().nullable().optional(),
      maxAmount: z.number().nullable().optional(),
      rounding: z.enum(["none", "nearest_1", "nearest_10"]).optional(),
    })
    .optional(),
  prorateOnAttendance: z.boolean().optional(),
  includeInGross: z.boolean().optional(),
  includeInCtc: z.boolean().optional(),
  taxable: z.boolean().optional(),
  order: z.number().int().min(1).max(1000).optional(),
  showOnPayslip: z.boolean().optional(),
  isStatutory: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const StructureSchema = z.object({
  name: z.string().trim().min(1).max(60),
  code: z.string().trim().min(1).max(20),
  description: z.string().max(300).optional(),
  components: z
    .array(
      z.object({
        componentId: objectId(),
        override: z
          .object({
            method: z.enum(["fixed", "percentage", "formula", "attendance_based", "manual"]).nullable().optional(),
            amount: z.number().nullable().optional(),
            percentage: z.number().nullable().optional(),
            ofComponent: z.string().nullable().optional(),
            expression: z.string().max(1000).nullable().optional(),
          })
          .optional(),
        order: z.number().int().nullable().optional(),
      })
    )
    .max(60)
    .optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

module.exports = {
  ComponentSchema,
  StructureSchema,
};
