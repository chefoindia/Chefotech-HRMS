"use strict";

const jwt = require("jsonwebtoken");
const crypto = require("node:crypto");
const { env } = require("../../config/env");
const { AppError } = require("../../core/errors/AppError");

/**
 * Token strategy.
 *
 *   ACCESS  — short-lived JWT (30 min). Carries the user id and the
 *             organization the session is scoped to. It does NOT carry
 *             permissions: those are resolved per request so that revoking a
 *             role takes effect within seconds instead of within 30 minutes.
 *
 *   REFRESH — long-lived opaque random string (30 days). Only its SHA-256 hash
 *             is stored. Rotated on every use, with reuse detection: presenting
 *             an already-rotated refresh token revokes the whole family, which
 *             is what turns a stolen token into a dead one.
 */

const ACCESS_AUDIENCE = "hrms-access";
const REFRESH_BYTES = 48;

function signAccessToken({ userId, organizationId, membershipId, isPlatformUser, platformRole }) {
  return jwt.sign(
    {
      sub: String(userId),
      org: organizationId ? String(organizationId) : null,
      mem: membershipId ? String(membershipId) : null,
      plt: isPlatformUser ? platformRole || "SUPPORT" : null,
    },
    env.jwt.accessSecret,
    {
      expiresIn: env.jwt.accessTtl,
      issuer: env.jwt.issuer,
      audience: ACCESS_AUDIENCE,
    }
  );
}

function verifyAccessToken(token) {
  try {
    return jwt.verify(token, env.jwt.accessSecret, {
      issuer: env.jwt.issuer,
      audience: ACCESS_AUDIENCE,
    });
  } catch (err) {
    if (err.name === "TokenExpiredError") throw new AppError("TOKEN_EXPIRED");
    throw new AppError("UNAUTHENTICATED");
  }
}

/** Create a refresh token. The plain value goes to the client, the hash to us. */
function createRefreshToken(family) {
  const plain = crypto.randomBytes(REFRESH_BYTES).toString("base64url");
  return {
    plain,
    hash: hashRefreshToken(plain),
    family: family || crypto.randomUUID(),
    expiresAt: new Date(Date.now() + parseDuration(env.jwt.refreshTtl)),
  };
}

function hashRefreshToken(plain) {
  return crypto.createHash("sha256").update(String(plain)).digest("hex");
}

function parseDuration(spec) {
  const match = /^(\d+)([smhd])$/.exec(String(spec));
  if (!match) return 30 * 24 * 3600 * 1000;
  const value = Number(match[1]);
  const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]];
  return value * unit;
}

/**
 * Where a token may come from, in priority order:
 *   1. Authorization: Bearer — the primary path.
 *   2. The httpOnly cookie — used by same-site deployments.
 *
 * Both exist because Chrome refuses cross-site cookies between an app on
 * :3000 and an API on :5001 without SameSite=None;Secure, which is impossible
 * over plain http in local development. The frontend therefore also keeps the
 * access token in memory and sends it as a Bearer header. This duplication is
 * intentional — removing either half breaks one of the two deployment shapes.
 */
function extractToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  if (req.cookies && req.cookies.hrms_access) return req.cookies.hrms_access;
  return null;
}

function extractRefreshToken(req) {
  if (req.body && req.body.refreshToken) return req.body.refreshToken;
  if (req.cookies && req.cookies.hrms_refresh) return req.cookies.hrms_refresh;
  return null;
}

function cookieOptions(maxAgeMs) {
  return {
    httpOnly: true,
    secure: env.cookies.secure,
    sameSite: env.cookies.sameSite,
    domain: env.cookies.domain,
    path: "/",
    maxAge: maxAgeMs,
  };
}

function setAuthCookies(res, { accessToken, refreshToken }) {
  if (accessToken) {
    res.cookie("hrms_access", accessToken, cookieOptions(parseDuration(env.jwt.accessTtl)));
  }
  if (refreshToken) {
    res.cookie("hrms_refresh", refreshToken, cookieOptions(parseDuration(env.jwt.refreshTtl)));
  }
}

function clearAuthCookies(res) {
  const base = { ...cookieOptions(0), maxAge: undefined };
  res.clearCookie("hrms_access", base);
  res.clearCookie("hrms_refresh", base);
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  createRefreshToken,
  hashRefreshToken,
  extractToken,
  extractRefreshToken,
  setAuthCookies,
  clearAuthCookies,
  parseDuration,
  ACCESS_AUDIENCE,
};
