"use strict";

const { z } = require("zod");
const mongoose = require("mongoose");

const objectId = () =>
  z
    .string()
    .refine((v) => mongoose.Types.ObjectId.isValid(v), "Must be a valid id");

const objectIdParam = (name = "id") => z.object({ [name]: objectId() });

const email = () =>
  z.string().trim().toLowerCase().email("Enter a valid email address");

const password = () =>
  z
    .string()
    .min(10, "Password must be at least 10 characters")
    .max(128, "Password is too long")
    .refine((v) => /[a-z]/.test(v), "Password must contain a lowercase letter")
    .refine((v) => /[A-Z]/.test(v), "Password must contain an uppercase letter")
    .refine((v) => /[0-9]/.test(v), "Password must contain a number");

const phone = () =>
  z
    .string()
    .trim()
    .regex(/^[+0-9][0-9\s\-()]{5,19}$/, "Enter a valid phone number");

/** "YYYY-MM-DD" — the platform's wire format for a calendar date. */
const dateString = () =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD")
    .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Not a real date");

/** "HH:mm" in 24-hour form. */
const timeString = () =>
  z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use the format HH:mm");

const slug = () =>
  z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "Use lowercase letters, numbers and hyphens");

const hexColor = () =>
  z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Use a hex colour like #4F46E5");

const listQuery = (extra = {}) =>
  z
    .object({
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
      sort: z.string().optional(),
      q: z.string().optional(),
      ...extra,
    })
    .passthrough();

/** Accept a boolean, or the strings/numbers a query string would carry. */
const boolish = () =>
  z
    .union([z.boolean(), z.enum(["true", "false", "1", "0"]), z.number()])
    .transform((v) => v === true || v === "true" || v === 1 || v === "1");

module.exports = {
  objectId,
  objectIdParam,
  email,
  password,
  phone,
  dateString,
  timeString,
  slug,
  hexColor,
  listQuery,
  boolish,
};
