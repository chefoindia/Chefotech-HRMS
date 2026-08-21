"use strict";

const mongoose = require("mongoose");
const { env } = require("./env");
const { logger } = require("./logger");

mongoose.set("strictQuery", true);
// Auto-index in dev only. In production indexes are created by migrations so a
// deploy never silently locks a large collection.
mongoose.set("autoIndex", !env.isProd);

let connectPromise = null;

async function connectDB(uri = env.db.uri) {
  if (connectPromise) return connectPromise;

  connectPromise = mongoose
    .connect(uri, {
      serverSelectionTimeoutMS: env.db.serverSelectionTimeoutMS,
      maxPoolSize: env.db.maxPoolSize,
    })
    .then((m) => {
      logger.info({ db: m.connection.name }, "MongoDB connected");
      return m;
    })
    .catch((err) => {
      connectPromise = null;
      throw err;
    });

  mongoose.connection.on("error", (err) =>
    logger.error({ err }, "MongoDB connection error")
  );
  mongoose.connection.on("disconnected", () =>
    logger.warn("MongoDB disconnected")
  );

  return connectPromise;
}

async function disconnectDB() {
  connectPromise = null;
  await mongoose.disconnect();
}

module.exports = { connectDB, disconnectDB, mongoose };
