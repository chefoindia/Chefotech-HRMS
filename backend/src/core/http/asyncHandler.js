"use strict";

/**
 * Express 5 forwards rejected promises to the error handler on its own, but
 * wrapping keeps the behaviour explicit and works identically for handlers
 * that are called outside a router (jobs, tests).
 */
function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
