"use strict";

const { ErrorCodes } = require("./errorCodes");

/**
 * The only error type allowed to reach the client verbatim. Everything else is
 * normalised to INTERNAL_ERROR by the error handler, so stack traces and
 * driver messages never leak out of the API.
 */
class AppError extends Error {
  constructor(code, overrides = {}) {
    const spec = ErrorCodes[code] || ErrorCodes.INTERNAL_ERROR;
    super(overrides.message || spec.message);
    this.name = "AppError";
    this.code = ErrorCodes[code] ? code : "INTERNAL_ERROR";
    this.status = overrides.status || spec.status;
    this.details = overrides.details;
    this.expose = true;
    // Log-only context. Never serialised to the client.
    this.meta = overrides.meta;
    if (Error.captureStackTrace) Error.captureStackTrace(this, AppError);
  }

  static notFound(entity) {
    return new AppError("NOT_FOUND", {
      message: `${entity || "Resource"} was not found.`,
    });
  }

  static conflict(message, details) {
    return new AppError("CONFLICT", { message, details });
  }

  static badRequest(message, details) {
    return new AppError("BAD_REQUEST", { message, details });
  }

  static forbidden(message) {
    return new AppError("FORBIDDEN", message ? { message } : {});
  }

  static validation(details, message) {
    return new AppError("VALIDATION_ERROR", { details, message });
  }

  toJSON() {
    const out = { code: this.code, message: this.message };
    if (this.details) out.details = this.details;
    return out;
  }
}

module.exports = { AppError };
