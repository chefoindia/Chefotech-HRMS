"use strict";

const { AppError } = require("./AppError");
const { logger } = require("../../config/logger");
const { env } = require("../../config/env");

function notFoundHandler(req, _res, next) {
  next(
    new AppError("NOT_FOUND", {
      message: `No route matches ${req.method} ${req.originalUrl}`,
    })
  );
}

/** Convert driver/library errors into AppErrors without leaking internals. */
function normalise(err) {
  if (err instanceof AppError) return err;

  if (err && err.name === "ValidationError" && err.errors) {
    const details = Object.entries(err.errors).map(([path, e]) => ({
      path,
      message: e.message,
    }));
    return new AppError("VALIDATION_ERROR", { details });
  }

  if (err && err.name === "CastError") {
    return new AppError("BAD_REQUEST", {
      message: `The supplied ${err.path} is not a valid ${err.kind}.`,
    });
  }

  if (err && err.code === 11000) {
    // organizationId is part of nearly every unique index in this schema;
    // naming it back to the user would only be confusing.
    const fields = Object.keys(err.keyPattern || err.keyValue || {}).filter(
      (f) => f !== "organizationId"
    );
    return new AppError("CONFLICT", {
      message: fields.length
        ? `A record with this ${fields.join(" + ")} already exists.`
        : "A record with these values already exists.",
    });
  }

  if (err && err.name === "TokenExpiredError") return new AppError("TOKEN_EXPIRED");
  if (err && err.name === "JsonWebTokenError") return new AppError("UNAUTHENTICATED");

  if (err && (err.type === "entity.too.large" || err.code === "LIMIT_FILE_SIZE")) {
    return new AppError("PAYLOAD_TOO_LARGE");
  }
  if (err && err.type === "entity.parse.failed") {
    return new AppError("BAD_REQUEST", { message: "Request body is not valid JSON." });
  }

  return new AppError("INTERNAL_ERROR");
}

function errorHandler(err, req, res, _next) {
  const appErr = normalise(err);

  const payload = {
    err,
    code: appErr.code,
    status: appErr.status,
    method: req.method,
    url: req.originalUrl,
    requestId: req.id,
    userId: req.auth && req.auth.userId,
    organizationId: req.auth && req.auth.organizationId,
    meta: appErr.meta,
  };

  if (appErr.status >= 500) logger.error(payload, appErr.message);
  else if (appErr.status >= 400) logger.warn(payload, appErr.message);

  const body = { success: false, error: appErr.toJSON(), requestId: req.id };

  // Stack traces are a development affordance only.
  if (!env.isProd && appErr.status >= 500) body.error.stack = err && err.stack;

  res.status(appErr.status).json(body);
}

module.exports = { errorHandler, notFoundHandler, normalise };
