"use strict";

/**
 * Platform bootstrap.
 *
 *   node scripts/seed.js
 *
 * Creates the Chefotech super-admin account. Idempotent — running it again
 * updates the name but never resets an existing password.
 */

const { env } = require("../src/config/env");
const { connectDB, disconnectDB } = require("../src/config/db");
const { logger } = require("../src/config/logger");
const User = require("../src/modules/users/user.model");

async function main() {
  await connectDB();

  const email = env.superAdmin.email.toLowerCase();
  let user = await User.findOne({ email }).select("+passwordHash");

  if (user) {
    user.isPlatformUser = true;
    user.platformRole = "SUPER_ADMIN";
    user.status = "active";
    user.firstName = env.superAdmin.name.split(" ")[0];
    await user.save();
    logger.info({ email }, "Super admin already exists; role reasserted, password unchanged");
  } else {
    const [firstName, ...rest] = env.superAdmin.name.split(" ");
    user = new User({
      email,
      firstName,
      lastName: rest.join(" "),
      isPlatformUser: true,
      platformRole: "SUPER_ADMIN",
      status: "active",
      emailVerifiedAt: new Date(),
    });
    await user.setPassword(env.superAdmin.password);
    await user.save();

    logger.info({ email }, "Super admin created");
    if (env.superAdmin.password === "ChangeMe@123") {
      logger.warn(
        "The default super-admin password is in use. Change it before this reaches a real deployment."
      );
    }
  }

  await disconnectDB();
}

main().catch(async (err) => {
  logger.error({ err }, "Seed failed");
  await disconnectDB().catch(() => {});
  process.exit(1);
});
