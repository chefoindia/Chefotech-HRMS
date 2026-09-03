"use strict";

const http = require("node:http");
const { env, assertProductionConfig } = require("./config/env");
const { logger } = require("./config/logger");
const { connectDB, disconnectDB } = require("./config/db");
const { createApp } = require("./app");
const queue = require("./core/jobs/queue");
const registerJobs = require("./jobs");
const realtime = require("./core/realtime/realtime");
const schedules = require("./jobs/schedules");
const mailer = require("./modules/notifications/mailer");

async function start() {
  assertProductionConfig();

  await connectDB();

  const app = createApp();
  const server = http.createServer(app);

  realtime.attach(server);

  registerJobs();
  queue.start();
  schedules.start();

  await new Promise((resolve) => server.listen(env.app.port, resolve));
  logger.info(
    { port: env.app.port, env: env.NODE_ENV, prefix: env.app.apiPrefix },
    `Chefotech HRMS API listening on http://localhost:${env.app.port}`
  );

  // Mail state, stated once at boot.
  //
  // Every outbound message in this product — password resets, invitations,
  // payslip notices, leave decisions — goes through one switch, and until now
  // that switch being off was invisible until somebody complained they never
  // got an email. Saying it here means the answer is in the first ten lines
  // of the deploy log instead of in a support thread.
  if (!env.mail.enabled) {
    logger.warn(
      { driver: env.mail.driver },
      "MAIL IS OFF (MAIL_ENABLED is not true) — no email will be sent from this server"
    );
  } else {
    logger.info(
      { driver: env.mail.driver, from: env.mail.from },
      "Mail enabled"
    );
    // Proves the credential and the sender actually work, rather than waiting
    // for the first real send to find out. Never throws: a mail provider being
    // unreachable is not a reason to refuse to boot the whole API.
    mailer
      .verify()
      .then((result) => {
        if (result.ok) logger.info({ driver: env.mail.driver }, "Mail provider reachable");
        else logger.error({ driver: env.mail.driver, reason: result.reason }, "MAIL PROVIDER REJECTED US — email will fail");
      })
      .catch((err) => logger.error({ err: err.message }, "Mail provider check failed"));
  }

  const shutdown = async (signal) => {
    logger.info({ signal }, "Shutting down");
    // Order matters: stop accepting work, let in-flight work finish, then
    // close the database. Reversing this drops jobs mid-write.
    server.close();
    schedules.stop();
    await queue.stop();
    await realtime.close();
    await disconnectDB();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "Unhandled promise rejection");
  });
  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Uncaught exception — exiting");
    process.exit(1);
  });

  return server;
}

if (require.main === module) {
  start().catch((err) => {
    logger.fatal({ err }, "Failed to start");
    process.exit(1);
  });
}

module.exports = { start };
