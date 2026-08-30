"use strict";

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const crypto = require("node:crypto");
const pinoHttp = require("pino-http");

const { env } = require("./config/env");
const { logger } = require("./config/logger");
const { errorHandler, notFoundHandler } = require("./core/errors/errorHandler");
const { apiLimiter } = require("./core/security/rateLimit");
const { AppError } = require("./core/errors/AppError");
const buildRoutes = require("./routes");

function createApp() {
  const app = express();

  // Behind a load balancer, req.ip must reflect the client, not the proxy —
  // rate limiting and audit logging are both wrong otherwise.
  if (env.app.trustProxy) app.set("trust proxy", 1);
  app.disable("x-powered-by");

  // ── Request identity ──────────────────────────────────────────────────────
  app.use((req, res, next) => {
    req.id = req.headers["x-request-id"] || crypto.randomUUID();
    res.setHeader("X-Request-Id", req.id);
    next();
  });

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      autoLogging: {
        ignore: (req) => req.url === "/health" || req.method === "OPTIONS",
      },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return "error";
        if (res.statusCode >= 400) return "warn";
        return "info";
      },
    })
  );

  // ── Security headers ──────────────────────────────────────────────────────
  app.use(
    helmet({
      // The API serves JSON and file streams, never HTML pages, so a strict
      // default CSP is safe here. The file proxy tightens it further.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          sandbox: ["allow-downloads"],
        },
      },
      crossOriginResourcePolicy: { policy: "cross-origin" },
      referrerPolicy: { policy: "no-referrer" },
    })
  );

  // ── CORS ──────────────────────────────────────────────────────────────────
  const allowed = new Set(env.cors.origins);
  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin, curl and server-to-server requests have no Origin.
        if (!origin) return callback(null, true);
        if (allowed.has(origin)) return callback(null, true);
        // Any *.chefotech.com subdomain in production, for tenant vanity hosts.
        if (env.isProd && /^https:\/\/[a-z0-9-]+\.chefotech\.com$/.test(origin)) {
          return callback(null, true);
        }
        logger.warn({ origin }, "Blocked by CORS");
        return callback(new AppError("FORBIDDEN", { message: "Origin not allowed" }));
      },
      credentials: true,
      exposedHeaders: ["X-Request-Id", "Content-Disposition"],
    })
  );

  // ── Body parsing ──────────────────────────────────────────────────────────
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true, limit: "2mb" }));
  app.use(cookieParser());

  /**
   * The API root.
   *
   * There is no UI here — the frontend is a separate deployment — but hosting
   * platforms probe `/` to decide whether the service is up, and browsers and
   * uptime monitors land on it too. Without this route every one of those
   * probes fell through to the 404 handler, which logs an AppError with a full
   * stack trace: on Render that is a fresh stack every thirty seconds, and
   * real errors get buried under it.
   *
   * It answers with where to actually go rather than an empty 200, so somebody
   * who opens the bare URL learns something.
   */
  app.get("/", (_req, res) => {
    res.json({
      success: true,
      data: {
        service: "chefotech-hrms-api",
        status: "ok",
        docs: `${env.app.apiPrefix}/public/plans`,
        health: "/health",
      },
    });
  });

  // ── Health, before rate limiting so probes are never throttled ────────────
  app.get("/health", (_req, res) => {
    res.json({
      success: true,
      data: {
        status: "ok",
        service: "chefotech-hrms-api",
        version: require("../package.json").version,
        env: env.NODE_ENV,
        uptimeSeconds: Math.round(process.uptime()),
      },
    });
  });

  /**
   * Readiness, as distinct from liveness above.
   *
   * `/health` answers "is this process running" and is what a load balancer
   * polls every few seconds — it must stay cheap and dependency-free, or a
   * slow database turns a health check into the thing that takes the service
   * down. This one answers "can it actually serve requests", by touching each
   * dependency, and is what a status page and a deploy gate should read.
   *
   * Returns 503 when a dependency is down so that automated checks do not have
   * to parse the body to find out.
   */
  app.get("/health/ready", async (_req, res) => {
    const mongoose = require("mongoose");
    const checks = {};

    const states = ["disconnected", "connected", "connecting", "disconnecting"];
    const readyState = mongoose.connection.readyState;
    checks.database = { ok: readyState === 1, detail: states[readyState] || "unknown" };

    if (checks.database.ok) {
      const startedAt = Date.now();
      try {
        await mongoose.connection.db.admin().ping();
        checks.database.latencyMs = Date.now() - startedAt;
      } catch (err) {
        checks.database = { ok: false, detail: err.message };
      }
    }

    try {
      const storage = require("./core/storage/storage.service");
      const result = await storage.healthCheck();
      checks.storage = {
        ok: Boolean(result.ok),
        documents: result.documents?.ok ?? result.ok,
        images: result.images?.ok ?? result.ok,
      };
    } catch (err) {
      checks.storage = { ok: false, detail: err.message };
    }

    const healthy = Object.values(checks).every((check) => check.ok);
    res.status(healthy ? 200 : 503).json({
      success: healthy,
      data: {
        status: healthy ? "ok" : "degraded",
        service: "chefotech-hrms-api",
        version: require("../package.json").version,
        uptimeSeconds: Math.round(process.uptime()),
        checks,
        checkedAt: new Date().toISOString(),
      },
    });
  });

  app.use(env.app.apiPrefix, apiLimiter, buildRoutes());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
