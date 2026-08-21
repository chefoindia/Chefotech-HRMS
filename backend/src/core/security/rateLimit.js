"use strict";

const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const { env } = require("../../config/env");
const { AppError } = require("../errors/AppError");

/**
 * Rate limiting.
 *
 * Keyed by tenant + user where we know them, and by IP where we do not. A
 * shared office NAT should not let one busy HR admin exhaust the whole
 * building's budget, and one noisy tenant should not throttle another.
 *
 * IP keys go through `ipKeyGenerator` rather than using req.ip directly: a
 * raw IPv6 address gives an attacker a practically unlimited number of
 * distinct keys from the same /64, which would make the limit decorative.
 */

function userOrIpKey(req) {
  if (req.auth && req.auth.userId) {
    return `u:${req.auth.organizationId || "none"}:${req.auth.userId}`;
  }
  return `ip:${ipKeyGenerator(req.ip)}`;
}

function handler(_req, _res, next) {
  next(new AppError("RATE_LIMITED"));
}

const common = {
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler,
  // Health checks and preflights are not worth counting.
  skip: (req) => req.method === "OPTIONS" || req.path === "/health",
};

/** The default budget for the whole API. */
const apiLimiter = rateLimit({
  ...common,
  windowMs: env.security.rateLimitWindowMs,
  limit: env.security.rateLimitMax,
  keyGenerator: userOrIpKey,
});

/** Sign-in and token endpoints. Always keyed by IP — there is no user yet. */
const authLimiter = rateLimit({
  ...common,
  windowMs: 15 * 60 * 1000,
  limit: env.security.authRateLimitMax,
  keyGenerator: (req) => `auth:${ipKeyGenerator(req.ip)}`,
  skipSuccessfulRequests: true,
});

/** Account creation, password reset, invitations — expensive and abusable. */
const strictLimiter = rateLimit({
  ...common,
  windowMs: 60 * 60 * 1000,
  limit: env.isTest ? 1000 : 10,
  keyGenerator: (req) => `strict:${ipKeyGenerator(req.ip)}`,
});

/** Bulk imports and report exports. */
const heavyLimiter = rateLimit({
  ...common,
  windowMs: 60 * 60 * 1000,
  limit: 30,
  keyGenerator: userOrIpKey,
});

module.exports = { apiLimiter, authLimiter, strictLimiter, heavyLimiter };
