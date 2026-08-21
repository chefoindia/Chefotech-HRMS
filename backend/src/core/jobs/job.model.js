"use strict";

const mongoose = require("mongoose");
const { createGlobalSchema } = require("../tenancy/baseSchema");

/**
 * Durable job records.
 *
 * Global rather than tenant-scoped by design: the worker has to be able to
 * claim the next job across all organizations before it knows which tenant it
 * belongs to. It then enters that tenant's context to run the handler.
 */
const jobSchema = createGlobalSchema({
  name: { type: String, required: true, index: true },
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Organization",
    default: null,
    index: true,
  },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },

  status: {
    type: String,
    enum: ["queued", "running", "succeeded", "failed", "cancelled"],
    default: "queued",
    index: true,
  },

  runAt: { type: Date, default: Date.now, index: true },
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 5 },

  lockedAt: { type: Date, default: null },
  lockedBy: { type: String, default: null },

  startedAt: { type: Date, default: null },
  finishedAt: { type: Date, default: null },
  durationMs: { type: Number, default: null },

  result: { type: mongoose.Schema.Types.Mixed, default: null },
  lastError: { type: String, default: null },
  errorHistory: { type: [{ at: Date, message: String }], default: [] },

  /**
   * Makes enqueueing idempotent. "Finalise attendance for org X on 2026-08-20"
   * has a stable key, so a cron that fires twice — or a retry after a crash
   * mid-write — cannot produce two runs.
   */
  idempotencyKey: { type: String, default: null },

  priority: { type: Number, default: 0 },
  createdByJob: { type: mongoose.Schema.Types.ObjectId, ref: "Job", default: null },
});

// Claim query: status + runAt + priority. This index is what keeps the poll
// cheap once the collection has a few hundred thousand finished jobs in it.
jobSchema.index({ status: 1, runAt: 1, priority: -1 });
jobSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
jobSchema.index({ organizationId: 1, name: 1, createdAt: -1 });
// Finished jobs are evidence for a fortnight, then noise.
jobSchema.index({ finishedAt: 1 }, { expireAfterSeconds: 14 * 24 * 3600 });

module.exports = mongoose.model("Job", jobSchema);
