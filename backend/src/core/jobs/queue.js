"use strict";

const os = require("node:os");
const crypto = require("node:crypto");
const Job = require("./job.model");
const { env } = require("../../config/env");
const { logger } = require("../../config/logger");
const tenant = require("../tenancy/tenantContext");

/**
 * A MongoDB-backed job queue.
 *
 * Deliberately not Redis/BullMQ: the platform already requires MongoDB and
 * nothing else, and an HRMS's job volume (payroll runs, biometric syncs,
 * nightly accruals, emails) is measured in thousands per day, not per second.
 * Adding a second datastore would buy throughput nobody needs at the cost of
 * an operational dependency every customer deployment has to run.
 *
 * Guarantees:
 *   - at-least-once delivery, so handlers must be idempotent;
 *   - a single atomic findOneAndUpdate claims a job, so two workers racing on
 *     the same document cannot both win;
 *   - jobs stuck in `running` past the stale threshold are reclaimed, which is
 *     what happens after a pod is killed mid-handler;
 *   - exponential backoff between attempts, capped.
 */

const WORKER_ID = `${os.hostname()}-${process.pid}-${crypto.randomBytes(3).toString("hex")}`;
const STALE_LOCK_MS = 10 * 60 * 1000;
const MAX_BACKOFF_MS = 30 * 60 * 1000;

const handlers = new Map();
let pollTimer = null;
let running = 0;
let stopped = true;

/**
 * Register a handler.
 * @param {string} name
 * @param {(payload: object, job: object) => Promise<any>} handler
 */
function register(name, handler) {
  if (handlers.has(name)) throw new Error(`Job handler '${name}' is already registered`);
  handlers.set(name, handler);
}

/**
 * Handlers are registered by the server entrypoint. An inline drain — the
 * path used when the worker is off, which is every test and many single-
 * process dev runs — can happen before that, or in a process that never
 * starts a server at all. Registering lazily here means "run this job now"
 * always finds its handler, and the claim query never silently skips work.
 */
function ensureRegistered() {
  if (handlers.size > 0) return;
  try {
    require("../../jobs")();
  } catch (err) {
    // A partial registration leaves whatever did register in place; the next
    // drain reports the missing handler for the job it claims.
    if (!/already registered/.test(String(err && err.message))) throw err;
  }
}

function registeredJobs() {
  return [...handlers.keys()];
}

/**
 * Enqueue work.
 *
 * The organization defaults to the ambient tenant, so a job enqueued while
 * handling a request automatically runs back in that same tenant's context.
 */
async function enqueue(name, payload = {}, options = {}) {
  const organizationId =
    options.organizationId !== undefined
      ? options.organizationId
      : tenant.getOrganizationId();

  const doc = {
    name,
    organizationId: organizationId || null,
    payload,
    runAt: options.runAt || new Date(),
    maxAttempts: options.maxAttempts || env.jobs.maxAttempts,
    priority: options.priority || 0,
    idempotencyKey: options.idempotencyKey || null,
    status: "queued",
  };

  if (doc.idempotencyKey) {
    try {
      return await Job.create(doc);
    } catch (err) {
      if (err.code === 11000) {
        logger.debug({ name, key: doc.idempotencyKey }, "Job already enqueued; skipping");
        return Job.findOne({ idempotencyKey: doc.idempotencyKey });
      }
      throw err;
    }
  }
  return Job.create(doc);
}

/** Enqueue for `delayMs` from now. */
function enqueueIn(name, payload, delayMs, options = {}) {
  return enqueue(name, payload, { ...options, runAt: new Date(Date.now() + delayMs) });
}

/** Atomically claim the next runnable job, or return null. */
async function claimNext() {
  const now = new Date();
  return Job.findOneAndUpdate(
    {
      $or: [
        { status: "queued", runAt: { $lte: now } },
        // Reclaim a job whose worker died holding the lock.
        { status: "running", lockedAt: { $lt: new Date(now.getTime() - STALE_LOCK_MS) } },
      ],
      name: { $in: [...handlers.keys()] },
    },
    {
      $set: { status: "running", lockedAt: now, lockedBy: WORKER_ID, startedAt: now },
      $inc: { attempts: 1 },
    },
    { sort: { priority: -1, runAt: 1 }, new: true }
  );
}

function backoffMs(attempt) {
  return Math.min(MAX_BACKOFF_MS, 2 ** attempt * 1000 + Math.floor(Math.random() * 1000));
}

async function runJob(job) {
  const handler = handlers.get(job.name);
  const startedAt = Date.now();

  if (!handler) {
    // Registered handlers are filtered in the claim query, so this only
    // happens if a handler was unregistered mid-flight.
    await Job.updateOne(
      { _id: job._id },
      { $set: { status: "queued", lockedAt: null, lockedBy: null } }
    );
    return;
  }

  const execute = () => handler(job.payload || {}, job);

  try {
    // A job belonging to an organization runs inside that tenant's context, so
    // every model call it makes is scoped exactly as a request would be.
    const result = job.organizationId
      ? await tenant.runWithTenant(String(job.organizationId), execute)
      : await tenant.runAsSystem(execute, `job:${job.name}`);

    await Job.updateOne(
      { _id: job._id },
      {
        $set: {
          status: "succeeded",
          result: result === undefined ? null : result,
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt,
          lockedAt: null,
          lockedBy: null,
          lastError: null,
        },
      }
    );
    logger.debug({ job: job.name, id: String(job._id), ms: Date.now() - startedAt }, "Job done");
  } catch (err) {
    const exhausted = job.attempts >= job.maxAttempts;
    const message = err && err.message ? err.message : String(err);

    await Job.updateOne(
      { _id: job._id },
      {
        $set: {
          status: exhausted ? "failed" : "queued",
          runAt: exhausted ? job.runAt : new Date(Date.now() + backoffMs(job.attempts)),
          lastError: message.slice(0, 2000),
          finishedAt: exhausted ? new Date() : null,
          lockedAt: null,
          lockedBy: null,
        },
        $push: {
          errorHistory: { $each: [{ at: new Date(), message: message.slice(0, 500) }], $slice: -10 },
        },
      }
    );

    logger[exhausted ? "error" : "warn"](
      { err, job: job.name, id: String(job._id), attempt: job.attempts, exhausted },
      exhausted ? "Job failed permanently" : "Job failed; will retry"
    );
  }
}

async function tick() {
  if (stopped) return;
  try {
    while (running < env.jobs.concurrency) {
      const job = await claimNext();
      if (!job) break;
      running += 1;
      runJob(job).finally(() => {
        running -= 1;
      });
    }
  } catch (err) {
    logger.error({ err }, "Job poll failed");
  }
}

function start() {
  if (!env.jobs.enabled) {
    logger.info("Job worker disabled by configuration");
    return;
  }
  if (pollTimer) return;
  stopped = false;
  pollTimer = setInterval(tick, env.jobs.pollIntervalMs);
  // unref so an idle worker never keeps the process alive on its own.
  if (pollTimer.unref) pollTimer.unref();
  logger.info({ worker: WORKER_ID, handlers: handlers.size }, "Job worker started");
}

async function stop() {
  stopped = true;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  // Give in-flight handlers a moment to finish before the process exits.
  const deadline = Date.now() + 15000;
  while (running > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** Run one job inline. Used by tests and by "run now" admin actions. */
async function drainOnce() {
  ensureRegistered();
  const job = await claimNext();
  if (!job) return null;
  await runJob(job);
  return Job.findById(job._id);
}

async function stats(organizationId) {
  const match = organizationId ? { organizationId } : {};
  const rows = await Job.aggregate([
    { $match: match },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  return rows.reduce((acc, r) => ({ ...acc, [r._id]: r.count }), {
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
  });
}

module.exports = {
  register,
  registeredJobs,
  enqueue,
  enqueueIn,
  start,
  stop,
  drainOnce,
  stats,
  Job,
  WORKER_ID,
};
