"use strict";

const mongoose = require("mongoose");
const { createTenantSchema } = require("../../core/tenancy/baseSchema");

/**
 * Integrations: API keys for other systems to call in, and webhooks for
 * this platform to call out.
 *
 * An API key is shown once and stored hashed; it carries a subset of its
 * creator's permissions, never more. A webhook subscribes to the same
 * events the notification pipeline emits, signed so the receiver can
 * verify who sent them.
 */
const apiKeySchema = createTenantSchema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    /** The first characters of the key, so people can tell keys apart in a list. */
    prefix: { type: String, required: true, index: true },
    hash: { type: String, required: true, unique: true },
    scopes: { type: [String], default: [] },
    expiresAt: { type: Date, default: null },
    lastUsedAt: { type: Date, default: null },
    lastUsedIp: { type: String, default: null },
    useCount: { type: Number, default: 0 },
    revokedAt: { type: Date, default: null },
    revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { softDelete: false }
);

const ApiKey = mongoose.model("ApiKey", apiKeySchema);

const webhookSchema = createTenantSchema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    url: { type: String, required: true, maxlength: 500 },
    /** Encrypted with secretBox; shown once. */
    secret: { type: String, required: true },
    events: { type: [String], default: [] },
    isActive: { type: Boolean, default: true, index: true },
    consecutiveFailures: { type: Number, default: 0 },
    lastDeliveredAt: { type: Date, default: null },
    lastStatus: { type: Number, default: null },
    lastError: { type: String, default: null },
    disabledReason: { type: String, default: null },
  },
  { softDelete: false }
);

const Webhook = mongoose.model("Webhook", webhookSchema);

const deliverySchema = createTenantSchema(
  {
    webhookId: { type: mongoose.Schema.Types.ObjectId, ref: "Webhook", required: true, index: true },
    event: { type: String, required: true, index: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ["pending", "delivered", "failed"], default: "pending", index: true },
    attempts: { type: Number, default: 0 },
    responseStatus: { type: Number, default: null },
    responseBody: { type: String, default: null },
    error: { type: String, default: null },
    durationMs: { type: Number, default: null },
    deliveredAt: { type: Date, default: null },
  },
  { softDelete: false }
);

deliverySchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

const WebhookDelivery = mongoose.model("WebhookDelivery", deliverySchema);

module.exports = { ApiKey, Webhook, WebhookDelivery };
