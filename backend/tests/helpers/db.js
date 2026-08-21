"use strict";

process.env.NODE_ENV = "test";
process.env.JOBS_ENABLED = "false";
process.env.LOG_LEVEL = "silent";
process.env.MAIL_ENABLED = "false";
process.env.BCRYPT_ROUNDS = "4";

const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");

let server = null;

/** Start an in-memory MongoDB and connect. Returns the connection uri. */
async function startDatabase() {
  if (server) return server.getUri();

  server = await MongoMemoryServer.create();
  const uri = server.getUri();
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 30000 });
  return uri;
}

async function stopDatabase() {
  await mongoose.disconnect();
  if (server) {
    await server.stop();
    server = null;
  }
}

/** Wipe every collection between tests without dropping indexes. */
async function clearDatabase() {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}

module.exports = { startDatabase, stopDatabase, clearDatabase, mongoose };
