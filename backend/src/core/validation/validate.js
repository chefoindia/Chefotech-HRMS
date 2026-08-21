"use strict";

const { z } = require("zod");
const { AppError } = require("../errors/AppError");

/**
 * Request validation middleware.
 *
 *   router.post("/", validate({ body: CreateEmployeeSchema }), handler)
 *
 * Validated output REPLACES req.body / req.query / req.params, so handlers
 * always work with coerced, stripped data — an unknown key in the payload can
 * never reach a Mongoose update.
 */
function validate(schemas) {
  return function validateMiddleware(req, _res, next) {
    const issues = [];

    for (const key of ["params", "query", "body"]) {
      const schema = schemas[key];
      if (!schema) continue;
      const result = schema.safeParse(req[key]);
      if (!result.success) {
        for (const issue of result.error.issues) {
          issues.push({
            path: [key, ...issue.path].join("."),
            field: issue.path.join(".") || key,
            message: issue.message,
            code: issue.code,
          });
        }
        continue;
      }
      // req.query is a getter-only property in Express 5.
      if (key === "query") {
        Object.defineProperty(req, "query", {
          value: result.data,
          writable: true,
          configurable: true,
        });
      } else {
        req[key] = result.data;
      }
    }

    if (issues.length) return next(AppError.validation(issues));
    return next();
  };
}

/** Validate a plain object outside the request cycle (imports, jobs, seeds). */
function validateData(schema, data, message) {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw AppError.validation(
      result.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      })),
      message
    );
  }
  return result.data;
}

module.exports = { validate, validateData, z };
