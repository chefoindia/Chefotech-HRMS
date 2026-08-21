"use strict";

const cron = require("node-cron");
const Organization = require("../modules/organizations/organization.model");
const queue = require("../core/jobs/queue");
const tenant = require("../core/tenancy/tenantContext");
const { logger } = require("../config/logger");
const { env } = require("../config/env");
const dt = require("../shared/datetime");

/**
 * The scheduler.
 *
 * Cron entries do NOT do work. They enqueue one job per active organization
 * and return, so:
 *
 *   - the actual work happens on the job worker, with retries and a record;
 *   - one tenant's slow payroll cannot delay another tenant's attendance;
 *   - each job carries an idempotency key derived from the tenant and the
 *     date, so two API instances both firing the same cron minute produce one
 *     job, not two.
 *
 * Schedules run against each organization's own timezone where the timing
 * matters — "finalise yesterday's attendance at 00:30" means 00:30 in Kolkata
 * for an Indian customer and 00:30 in Dubai for a UAE one.
 */

const tasks = [];

/** Every organization that should have background work run for it. */
async function activeOrganizations() {
  return tenant.runAsSystem(
    () =>
      Organization.find({ status: { $in: ["trial", "active", "past_due"] }, deletedAt: null })
        .select("_id name timezone plan.features featureOverrides")
        .lean(),
    "schedules.list-organizations"
  );
}

/** Enqueue `jobName` for every organization, keyed for idempotency. */
async function fanOut(jobName, buildPayload = () => ({}), options = {}) {
  const organizations = await activeOrganizations();
  let enqueued = 0;

  for (const organization of organizations) {
    try {
      if (options.onlyWhen && !(await options.onlyWhen(organization))) continue;

      const localDate = dt.todayString(organization.timezone);
      const localHour = dt.nowIn(organization.timezone).hour();

      if (options.atLocalHour !== undefined && localHour !== options.atLocalHour) continue;

      await queue.enqueue(jobName, buildPayload(organization, localDate), {
        organizationId: organization._id,
        idempotencyKey: options.keyed === false
          ? null
          : `${jobName}:${organization._id}:${options.keySuffix ? options.keySuffix(organization, localDate) : localDate}`,
        priority: options.priority || 0,
      });
      enqueued += 1;
    } catch (err) {
      logger.error(
        { err, jobName, organizationId: String(organization._id) },
        "Could not enqueue a scheduled job"
      );
    }
  }

  if (enqueued) logger.debug({ jobName, enqueued }, "Scheduled jobs enqueued");
  return enqueued;
}

function start() {
  if (!env.jobs.enabled) {
    logger.info("Scheduler disabled by configuration");
    return;
  }

  // Biometric sync — every five minutes. The service itself decides which
  // devices are actually due, and backs off ones that keep failing.
  tasks.push(
    cron.schedule("*/5 * * * *", () => {
      fanOut("biometric.sync-due", () => ({}), { keyed: false }).catch((err) =>
        logger.error({ err }, "Biometric sync fan-out failed")
      );
    })
  );

  // Attendance finalisation — hourly, acting only in each organization's own
  // 00:00 hour, so every tenant gets it just after their midnight.
  tasks.push(
    cron.schedule("15 * * * *", () => {
      fanOut(
        "attendance.daily-finalise",
        (organization, localDate) => ({ date: dt.addDays(localDate, -1) }),
        {
          atLocalHour: 0,
          priority: 5,
          keySuffix: (organization, localDate) => dt.addDays(localDate, -1),
        }
      ).catch((err) => logger.error({ err }, "Attendance finalisation fan-out failed"));
    })
  );

  // Document expiry reminders — once a day, at 09:00 local.
  tasks.push(
    cron.schedule("10 * * * *", () => {
      fanOut("documents.expiry-reminders", () => ({}), { atLocalHour: 9 }).catch((err) =>
        logger.error({ err }, "Document reminder fan-out failed")
      );
    })
  );

  // Overdue approvals — escalation and auto-approval, hourly.
  tasks.push(
    cron.schedule("30 * * * *", () => {
      fanOut("workflow.process-overdue", () => ({}), { keyed: false }).catch((err) =>
        logger.error({ err }, "Approval escalation fan-out failed")
      );
    })
  );

  // Monthly leave accrual — on the 1st, at 01:00 local.
  tasks.push(
    cron.schedule("20 * * * *", () => {
      fanOut(
        "leave.monthly-accrual",
        (organization, localDate) => ({ date: localDate }),
        {
          atLocalHour: 1,
          async onlyWhen(organization) {
            return dt.nowIn(organization.timezone).date() === 1;
          },
          keySuffix: (organization, localDate) => localDate.slice(0, 7),
        }
      ).catch((err) => logger.error({ err }, "Leave accrual fan-out failed"));
    })
  );

  // Year-end carry forward — 1 January at 02:00 local.
  tasks.push(
    cron.schedule("25 * * * *", () => {
      fanOut(
        "leave.year-end-carry-forward",
        (organization, localDate) => ({ year: Number(localDate.slice(0, 4)) - 1 }),
        {
          atLocalHour: 2,
          async onlyWhen(organization) {
            const now = dt.nowIn(organization.timezone);
            return now.month() === 0 && now.date() === 1;
          },
          keySuffix: (organization, localDate) => localDate.slice(0, 4),
        }
      ).catch((err) => logger.error({ err }, "Carry-forward fan-out failed"));
    })
  );

  // Usage recalculation — nightly at 03:00 local, for plan limit enforcement.
  tasks.push(
    cron.schedule("40 * * * *", () => {
      fanOut("organization.recalculate-usage", () => ({}), { atLocalHour: 3 }).catch((err) =>
        logger.error({ err }, "Usage recalculation fan-out failed")
      );
    })
  );

  logger.info({ tasks: tasks.length }, "Scheduler started");
}

function stop() {
  for (const task of tasks) {
    try {
      task.stop();
    } catch {
      /* already stopped */
    }
  }
  tasks.length = 0;
}

module.exports = { start, stop, fanOut };
