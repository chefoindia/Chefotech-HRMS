"use strict";

const { z } = require("zod");
const { objectId, password } = require("../../core/validation/common");

/**
 * The shapes the biometric endpoints accept.
 *
 * Lifted out of the routes file so the form registry can read them. That
 * registry derives every field's type, bounds and options from these
 * definitions rather than restating them, which only stays honest while
 * this file is the single place they are written down.
 */
const DeviceSchema = z.object({
  name: z.string().trim().min(1).max(60),
  code: z.string().trim().min(1).max(20),
  provider: z.string().trim().min(1).max(40),
  mode: z.enum(["lan", "http", "cloud", "webhook", "file", "manual"]).optional(),
  connection: z
    .object({
      host: z.string().max(120).optional(),
      port: z.number().int().min(1).max(65535).nullable().optional(),
      baseUrl: z.string().max(300).optional(),
      username: z.string().max(80).optional(),
      password: z.string().max(200).optional(),
      apiKey: z.string().max(300).optional(),
      serialNumber: z.string().max(60).optional(),
      deviceNumber: z.number().int().optional(),
      useSsl: z.boolean().optional(),
      timeoutMs: z.number().int().min(1000).max(120000).optional(),
      extra: z.record(z.any()).optional(),
    })
    .optional(),
  locationId: objectId().nullable().optional(),
  timezone: z.string().max(60).nullable().optional(),
  defaultDirection: z.enum(["in", "out"]).nullable().optional(),
  sync: z
    .object({
      enabled: z.boolean().optional(),
      intervalMinutes: z.number().int().min(1).max(1440).optional(),
    })
    .optional(),
  isActive: z.boolean().optional(),
  notes: z.string().max(500).optional(),
});

module.exports = {
  DeviceSchema,
};
