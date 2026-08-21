"use strict";

const mongoose = require("mongoose");
const { createTenantSchema, tenantUnique } = require("../../core/tenancy/baseSchema");

/**
 * The raw event layer.
 *
 * This is exactly what the device reported, stored before anything is
 * interpreted. It is never edited and never deleted by the application:
 *
 *   BiometricEvent (immutable)
 *     → employee mapping
 *       → Punch (interpreted)
 *         → AttendanceRecord (computed)
 *
 * Keeping the raw layer is what makes it possible to reprocess a month after
 * discovering that a device's clock was an hour out, or that two employees had
 * swapped enrolment ids — without asking the customer to re-import anything.
 */
const biometricEventSchema = createTenantSchema(
  {
    deviceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BiometricDevice",
      required: true,
      index: true,
    },

    /** The id as the device knows it. Mapped to an employee separately. */
    deviceUserId: { type: String, required: true, index: true },

    /** The instant the device reported, converted to UTC on ingest. */
    occurredAt: { type: Date, required: true, index: true },
    /** The raw local timestamp string, kept verbatim for forensics. */
    rawTimestamp: { type: String, default: null },

    direction: { type: String, enum: ["in", "out", null], default: null },
    verifyMode: { type: String, default: null }, // fingerprint, face, card, password
    workCode: { type: String, default: null },

    /** The untouched payload, whatever shape the adapter received. */
    raw: { type: mongoose.Schema.Types.Mixed, default: null },

    // ── Processing state ─────────────────────────────────────────────────
    processingStatus: {
      type: String,
      enum: ["pending", "mapped", "unmapped", "duplicate", "ignored", "error"],
      default: "pending",
      index: true,
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      default: null,
      index: true,
    },
    punchId: { type: mongoose.Schema.Types.ObjectId, ref: "Punch", default: null },
    processedAt: { type: Date, default: null },
    processingError: { type: String, default: null },

    syncLogId: { type: mongoose.Schema.Types.ObjectId, ref: "BiometricSyncLog", default: null },
  },
  { softDelete: false }
);

/**
 * The idempotency guarantee. A device re-sending its whole buffer — which is
 * routine after a power cut — cannot create a second event for the same tap.
 */
tenantUnique(biometricEventSchema, ["deviceId", "deviceUserId", "occurredAt"]);
biometricEventSchema.index({ organizationId: 1, processingStatus: 1, occurredAt: -1 });
biometricEventSchema.index({ organizationId: 1, deviceId: 1, occurredAt: -1 });

/** Raw events are evidence; the application never rewrites them. */
function blockMutation(next) {
  next(new Error("Biometric events are immutable; update the processing fields instead"));
}
biometricEventSchema.pre("replaceOne", blockMutation);
biometricEventSchema.pre("deleteMany", blockMutation);

const BiometricEvent = mongoose.model("BiometricEvent", biometricEventSchema);

/** One record per sync attempt. The device page shows these verbatim. */
const biometricSyncLogSchema = createTenantSchema(
  {
    deviceId: { type: mongoose.Schema.Types.ObjectId, ref: "BiometricDevice", required: true, index: true },
    trigger: { type: String, enum: ["scheduled", "manual", "webhook", "import"], default: "scheduled" },

    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date, default: null },
    durationMs: { type: Number, default: null },

    status: {
      type: String,
      enum: ["running", "success", "partial", "failed"],
      default: "running",
      index: true,
    },

    eventsFetched: { type: Number, default: 0 },
    eventsNew: { type: Number, default: 0 },
    eventsDuplicate: { type: Number, default: 0 },
    eventsUnmapped: { type: Number, default: 0 },
    punchesCreated: { type: Number, default: 0 },
    daysReprocessed: { type: Number, default: 0 },

    error: { type: String, default: null },
    /** Unmapped device ids, so an administrator can fix the enrolment. */
    unmappedDeviceUserIds: { type: [String], default: [] },

    triggeredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { softDelete: false }
);

biometricSyncLogSchema.index({ organizationId: 1, deviceId: 1, startedAt: -1 });
biometricSyncLogSchema.index({ startedAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

const BiometricSyncLog = mongoose.model("BiometricSyncLog", biometricSyncLogSchema);

module.exports = { BiometricEvent, BiometricSyncLog };
