"use strict";

const multer = require("multer");
const { env } = require("../../config/env");
const { AppError } = require("../errors/AppError");

/**
 * Uploads are buffered in memory rather than written to disk.
 *
 * The API is designed to run on ephemeral, possibly read-only containers, and
 * a temp file that outlives a crashed request is an HR document sitting
 * unencrypted on a shared volume. Files go straight from the request buffer to
 * the storage provider. The size cap keeps memory bounded.
 */
function uploadSingle(field = "file", { maxBytes } = {}) {
  const uploader = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxBytes || env.storage.maxUploadBytes,
      files: 1,
      fields: 20,
    },
  }).single(field);

  return function middleware(req, res, next) {
    uploader(req, res, (err) => {
      if (err) return next(translate(err));
      if (!req.file) {
        return next(AppError.badRequest(`No file was uploaded in the '${field}' field.`));
      }
      return next();
    });
  };
}

function uploadMany(field = "files", maxCount = 10) {
  const uploader = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: env.storage.maxUploadBytes, files: maxCount },
  }).array(field, maxCount);

  return function middleware(req, res, next) {
    uploader(req, res, (err) => {
      if (err) return next(translate(err));
      return next();
    });
  };
}

function translate(err) {
  if (err.code === "LIMIT_FILE_SIZE") {
    return new AppError("PAYLOAD_TOO_LARGE", {
      message: `Files must be smaller than ${Math.round(env.storage.maxUploadBytes / 1024 / 1024)}MB.`,
    });
  }
  if (err.code === "LIMIT_UNEXPECTED_FILE") {
    return AppError.badRequest(`Unexpected file field '${err.field}'.`);
  }
  return err;
}

module.exports = { uploadSingle, uploadMany };
