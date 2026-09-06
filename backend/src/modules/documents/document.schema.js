"use strict";

const { z } = require("zod");
const { objectId, nullableObjectId, nullableDateString, boolish } = require("../../core/validation/common");
const { BLOCK_TYPES, TEMPLATE_CATEGORIES, CONTEXT_TYPES } = require("./document.model");

/**
 * The shapes the document endpoints accept.
 *
 * Lifted out of the routes file so the form registry can read them. That
 * registry derives every field's type, bounds and options from these
 * definitions rather than restating them, which only stays honest while
 * this file is the single place they are written down.
 */
const ColumnSchema = z.object({
  key: z.string().max(60),
  label: z.string().max(80),
  width: z.number().min(0.1).max(20).optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  format: z.enum(["text", "number", "integer", "money", "percent", "date"]).optional(),
  total: z.boolean().optional(),
});

const BlockSchema = z.object({
  type: z.enum(BLOCK_TYPES),
  text: z.string().max(8000).optional(),
  level: z.number().int().min(1).max(3).optional(),
  underline: z.boolean().optional(),
  columns: z.array(ColumnSchema).max(30).optional(),
  rows: z.array(z.any()).max(500).optional(),
  source: z.string().max(80).nullable().optional(),
  zebra: z.boolean().optional(),
  showIndex: z.boolean().optional(),
  totalsLabel: z.string().max(40).optional(),
  emptyText: z.string().max(120).optional(),
  headerColour: z.string().max(9).nullable().optional(),
  layout: z.enum(["double", "single"]).optional(),
  inline: z.boolean().optional(),
  left: z.string().max(4000).optional(),
  right: z.string().max(4000).optional(),
  items: z.array(z.string().max(500)).max(100).optional(),
  condition: z.string().max(300).nullable().optional(),
  align: z.enum(["left", "right"]).optional(),
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
  fileId: nullableObjectId(),
});

const TemplateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  code: z.string().trim().min(1).max(30),
  description: z.string().max(300).optional(),
  category: z.enum(TEMPLATE_CATEGORIES).optional(),
  contextType: z.enum(CONTEXT_TYPES).optional(),
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
      showContact: z.boolean().optional(),
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
      showVerificationQr: z.boolean().optional(),
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
  storeAs: z
    .object({
      category: z
        .enum(["identity", "employment", "education", "salary", "certificate", "company", "medical", "other"])
        .nullable()
        .optional(),
      visibleToEmployee: z.boolean().optional(),
      requireAcknowledgement: z.boolean().optional(),
    })
    .optional(),
  tags: z.array(z.string().max(30)).max(20).optional(),
  isActive: z.boolean().optional(),
});

const DOCUMENT_CATEGORIES = ["identity", "employment", "education", "salary", "certificate", "company", "medical", "other"];

/**
 * A list of ids that may arrive as a real array (JSON body) or as one JSON
 * string (a multipart form field). z.coerce.boolean() is deliberately not
 * used anywhere in this file: it turns the string "false" into true.
 */
const idList = () =>
  z
    .preprocess(
      (value) => {
        if (typeof value !== "string") return value;
        if (!value.trim()) return [];
        try {
          return JSON.parse(value);
        } catch {
          return value.split(",").map((v) => v.trim()).filter(Boolean);
        }
      },
      z.array(objectId()).max(50)
    )
    .optional();

const CompanyDocumentSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().max(2000).optional(),
  category: z.enum(["policy", "handbook", "form", "circular", "procedure", "other"]).optional(),
  version: z.string().max(20).optional(),
  effectiveFrom: nullableDateString(),
  audience: z.enum(["all", "departments", "locations"]).optional(),
  departmentIds: idList(),
  locationIds: idList(),
  requireAcknowledgement: boolish().optional(),
  isActive: boolish().optional(),
});

const DocumentRequestSchema = z.object({
  employeeIds: z.array(objectId()).min(1).max(500),
  name: z.string().trim().min(1).max(120),
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
  note: z.string().max(1000).optional(),
  dueOn: nullableDateString(),
});

const SheetColumnSchema = z.object({
  key: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(80),
  width: z.number().min(4).max(80).optional(),
  format: z.enum(["text", "number", "integer", "money", "percent", "date", "boolean"]).optional(),
  align: z.enum(["left", "center", "right"]).nullable().optional(),
  total: z.boolean().optional(),
  expression: z.string().max(500).nullable().optional(),
  hidden: z.boolean().optional(),
});

const SheetTemplateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  code: z.string().trim().min(1).max(30),
  description: z.string().max(300).optional(),
  source: z.string().min(1).max(40),
  columns: z.array(SheetColumnSchema).max(80).optional(),
  filters: z.record(z.any()).optional(),
  sort: z.string().max(60).nullable().optional(),
  groupBy: z.string().max(60).nullable().optional(),
  header: z
    .object({
      showCompany: z.boolean().optional(),
      title: z.string().max(120).optional(),
      subtitle: z.string().max(200).optional(),
      showPeriod: z.boolean().optional(),
      showGeneratedOn: z.boolean().optional(),
    })
    .optional(),
  footer: z
    .object({
      text: z.string().max(300).optional(),
      showTotals: z.boolean().optional(),
      signatureLabels: z.array(z.string().max(40)).max(4).optional(),
    })
    .optional(),
  page: z
    .object({
      orientation: z.enum(["portrait", "landscape"]).optional(),
      size: z.enum(["A4", "LETTER", "LEGAL", "A3"]).optional(),
    })
    .optional(),
  freezeHeader: z.boolean().optional(),
  showRowNumbers: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

module.exports = {
  BlockSchema,
  TemplateSchema,
  CompanyDocumentSchema,
  DocumentRequestSchema,
  SheetTemplateSchema,
  SheetColumnSchema,
  DOCUMENT_CATEGORIES,
};
