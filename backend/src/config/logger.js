"use strict";

const pino = require("pino");
const { env } = require("./env");

/**
 * Structured logging. Anything that looks like a credential or personal
 * identifier is redacted before it reaches a log sink — HRMS logs contain
 * salary, biometric and identity data by nature, so redaction is not optional.
 */
const REDACT = [
  "req.headers.authorization",
  "req.headers.cookie",
  "password",
  "*.password",
  "passwordHash",
  "*.passwordHash",
  "token",
  "*.token",
  "accessToken",
  "refreshToken",
  "*.refreshToken",
  "apiKey",
  "*.apiKey",
  "secret",
  "*.secret",
  "GOOGLE_SERVICE_ACCOUNT_KEY",
];

const logger = pino({
  level: env.log.level,
  redact: { paths: REDACT, censor: "[redacted]" },
  base: { service: "hrms-api", env: env.NODE_ENV },
  transport: env.log.pretty
    ? { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss" } }
    : undefined,
});

module.exports = { logger };
