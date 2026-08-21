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
