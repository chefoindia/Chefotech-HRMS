"use strict";

const mongoose = require("mongoose");
const { createTenantSchema, tenantUnique } = require("../../core/tenancy/baseSchema");

/**
 * A biometric attendance device.
 *
 * Configuration is generic on purpose: `provider` selects an adapter and
 * `connection` carries whatever that adapter needs. Adding support for a new
 * manufacturer means writing an adapter, not adding columns here and not
 * touching the attendance engine.
 */
const biometricDeviceSchema = createTenantSchema({
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, trim: true, uppercase: true },

  /** Which adapter drives this device. */
  provider: {
    type: String,
    required: true,
    // Kept as a plain string rather than an enum so a customer-specific
    // adapter can be registered without a schema migration.
  },

  /** How we reach it. */
  mode: {
    type: String,
    enum: ["lan", "http", "cloud", "webhook", "file", "manual"],
    default: "lan",
  },

  connection: {
    host: { type: String, default: "" },
    port: { type: Number, default: null },
    baseUrl: { type: String, default: "" },
    username: { type: String, default: "" },
    // Credentials are write-only over the API: never returned in a response.
    password: { type: String, default: "", select: false },
    apiKey: { type: String, default: "", select: false },
    serialNumber: { type: String, default: "" },
    deviceNumber: { type: Number, default: 1 },
    useSsl: { type: Boolean, default: false },
    timeoutMs: { type: Number, default: 15000 },
    extra: { type: mongoose.Schema.Types.Mixed, default: {} },
  },

  locationId: { type: mongoose.Schema.Types.ObjectId, ref: "Location", default: null, index: true },
  /** Device clock timezone. Defaults to the location's, then the org's. */
  timezone: { type: String, default: null },

  /** Direction to stamp on punches this device produces, if it is fixed. */
  defaultDirection: { type: String, enum: ["in", "out", null], default: null },

  sync: {
    enabled: { type: Boolean, default: true },
    intervalMinutes: { type: Number, default: 15, min: 1, max: 1440 },
    lastSyncAt: { type: Date, default: null },
    lastSyncStatus: {
      type: String,
      enum: ["never", "success", "partial", "failed"],
      default: "never",
    },
    lastError: { type: String, default: null },
    /** Watermark: only events after this are pulled on the next sync. */
    lastEventAt: { type: Date, default: null },
    consecutiveFailures: { type: Number, default: 0 },
  },

  status: {
    type: String,
    enum: ["unknown", "online", "offline", "error"],
    default: "unknown",
    index: true,
  },
  lastSeenAt: { type: Date, default: null },
  firmwareVersion: { type: String, default: "" },
  enrolledUserCount: { type: Number, default: 0 },

  isActive: { type: Boolean, default: true, index: true },
  notes: { type: String, default: "" },
});

tenantUnique(biometricDeviceSchema, "code");
biometricDeviceSchema.index({ organizationId: 1, "sync.enabled": 1, isActive: 1 });

module.exports = mongoose.model("BiometricDevice", biometricDeviceSchema);
