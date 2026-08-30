"use strict";

const { z } = require("zod");
const { objectId } = require("../../core/validation/common");

/**
 * The shapes the document endpoints accept.
 *
 * Lifted out of the routes file so the form registry can read them. That
 * registry derives every field's type, bounds and options from these
 * definitions rather than restating them, which only stays honest while
 * this file is the single place they are written down.
 */
const BlockSchema = z.object({
  type: z.enum([
    "heading", "paragraph", "spacer", "divider", "table",
    "key_values", "signature", "page_break", "image", "list",
  ]),
  text: z.string().max(5000).optional(),
  columns: z
    .array(z.object({ key: z.string(), label: z.string(), width: z.number().optional(), align: z.string().optional() }))
    .optional(),
  rows: z.array(z.any()).optional(),
  source: z.string().max(80).nullable().optional(),
  items: z.array(z.string().max(500)).optional(),
  condition: z.string().max(300).nullable().optional(),
  style: z
    .object({
      fontSize: z.number().min(6).max(48).nullable().optional(),
      bold: z.boolean().optional(),
      italic: z.boolean().optional(),
      align: z.enum(["left", "center", "right", "justify"]).optional(),
      colour: z.string().max(9).nullable().optional(),
      marginTop: z.number().nullable().optional(),
      marginBottom: z.number().nullable().optional(),
    })
    .optional(),
  height: z.number().nullable().optional(),
  fileId: objectId().nullable().optional(),
});

const TemplateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  code: z.string().trim().min(1).max(30),
  description: z.string().max(300).optional(),
  category: z
    .enum([
      "offer_letter", "appointment_letter", "experience_certificate", "relieving_letter",
      "salary_slip", "salary_certificate", "leave_approval", "warning_letter",
      "increment_letter", "promotion_letter", "confirmation_letter", "id_card",
      "attendance_report", "custom",
    ])
    .optional(),
  contextType: z.enum(["employee", "payslip", "leave_request", "organization"]).optional(),
  page: z
    .object({
      size: z.enum(["A4", "LETTER", "LEGAL"]).optional(),
      orientation: z.enum(["portrait", "landscape"]).optional(),
      margins: z
        .object({
          top: z.number().min(0).max(200).optional(),
          bottom: z.number().min(0).max(200).optional(),
          left: z.number().min(0).max(200).optional(),
          right: z.number().min(0).max(200).optional(),
        })
        .optional(),
    })
    .optional(),
  header: z
    .object({
      enabled: z.boolean().optional(),
      showLogo: z.boolean().optional(),
      showCompanyName: z.boolean().optional(),
      showAddress: z.boolean().optional(),
      text: z.string().max(500).optional(),
      useLetterhead: z.boolean().optional(),
    })
    .optional(),
  footer: z
    .object({
      enabled: z.boolean().optional(),
      text: z.string().max(500).optional(),
      showPageNumbers: z.boolean().optional(),
      showGeneratedOn: z.boolean().optional(),
    })
    .optional(),
  watermark: z
    .object({
      enabled: z.boolean().optional(),
      text: z.string().max(60).optional(),
      opacity: z.number().min(0.01).max(0.5).optional(),
    })
    .optional(),
  blocks: z.array(BlockSchema).max(200).optional(),
  numbering: z
    .object({
      enabled: z.boolean().optional(),
      prefix: z.string().max(20).optional(),
      nextNumber: z.number().int().min(1).optional(),
      padding: z.number().int().min(1).max(10).optional(),
    })
    .optional(),
  isActive: z.boolean().optional(),
});

module.exports = {
  BlockSchema,
  TemplateSchema,
};
