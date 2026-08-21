"use strict";

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { env } = require("../../config/env");

/**
 * Filesystem provider for local development and tests, so a contributor can
 * run the whole platform without Google credentials. It intentionally exposes
 * no public URL: in local mode every file — public or private — is served
 * through the same authenticated proxy route.
 */

function rootDir() {
  return path.resolve(env.storage.localRoot);
}

function pathFor(id) {
  // Ids are generated here, but treat them as untrusted anyway: a traversal
  // in a storage layer is how "download my payslip" becomes "read /etc/passwd".
  const safe = String(id).replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(rootDir(), safe);
}

async function upload({ buffer, fileName, mimeType, orgFolderName, category }) {
  const id = crypto.randomUUID();
  await fsp.mkdir(rootDir(), { recursive: true });
  await fsp.writeFile(pathFor(id), buffer);
  await fsp.writeFile(
    `${pathFor(id)}.meta.json`,
    JSON.stringify({ fileName, mimeType, orgFolderName, category, size: buffer.length })
  );
  return { providerId: id, fileName, mimeType, size: buffer.length, webViewLink: null };
}

async function stream(id) {
  const meta = JSON.parse(await fsp.readFile(`${pathFor(id)}.meta.json`, "utf8"));
  return {
    stream: fs.createReadStream(pathFor(id)),
    mimeType: meta.mimeType || "application/octet-stream",
    fileName: meta.fileName || null,
    size: meta.size || null,
  };
}

async function remove(id) {
  await fsp.rm(pathFor(id), { force: true });
  await fsp.rm(`${pathFor(id)}.meta.json`, { force: true });
}

async function setVisibility() {
  /* no-op: local files are never publicly reachable */
}

async function getMetadata(id) {
  return JSON.parse(await fsp.readFile(`${pathFor(id)}.meta.json`, "utf8"));
}

async function healthCheck() {
  try {
    await fsp.mkdir(rootDir(), { recursive: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

module.exports = {
  name: "local",
  upload,
  stream,
  remove,
  setVisibility,
  getMetadata,
  healthCheck,
};
