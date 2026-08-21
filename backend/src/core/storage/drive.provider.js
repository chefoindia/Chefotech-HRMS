"use strict";

const { Readable } = require("node:stream");
const { google } = require("googleapis");
const { env } = require("../../config/env");
const { logger } = require("../../config/logger");
const { AppError } = require("../errors/AppError");

/**
 * Google Drive storage provider (service account).
 *
 * Why a service account and not OAuth: a refresh token tied to a person
 * expires, gets revoked when they change their password, and dies the day they
 * leave. Payroll documents cannot depend on that. The service account's
 * credentials never expire.
 *
 * Two visibility modes, and the difference matters:
 *
 *   PUBLIC  — branding logos, avatars, marketing images. The file is shared
 *             with "anyone with the link" and rendered in the browser through
 *             https://lh3.googleusercontent.com/d/<fileId>=w<width>. That
 *             endpoint serves the raw bytes with permissive CORS and supports
 *             on-the-fly resizing, which is why it works in an <img> tag while
 *             drive.google.com/uc redirects to an HTML interstitial and fails.
 *
 *   PRIVATE — every employee document, payslip and identity scan. The file is
 *             NEVER shared publicly. It is fetched by the API with the service
 *             account and streamed to the browser only after the caller's
 *             tenant and permissions have been checked. A leaked Drive file id
 *             on its own is worthless.
 */

const FOLDER_MIME = "application/vnd.google-apps.folder";

let cachedAuth = null;

function getAuth() {
  if (cachedAuth) return cachedAuth;

  const raw = env.storage.drive.serviceAccountKey;
  if (!raw) {
    throw new AppError("STORAGE_ERROR", {
      message: "Google Drive storage is not configured.",
      meta: { hint: "Set GOOGLE_SERVICE_ACCOUNT_KEY in the environment." },
    });
  }

  let key;
  try {
    key = JSON.parse(raw);
  } catch (err) {
    throw new AppError("STORAGE_ERROR", {
      message: "Google Drive storage is not configured correctly.",
      meta: { reason: "GOOGLE_SERVICE_ACCOUNT_KEY is not valid JSON" },
    });
  }

  // dotenv keeps the private key's newlines as the literal characters \ and n.
  // The RSA signer needs real newlines or every request fails with
  // "error:1E08010C:DECODER routines::unsupported".
  if (key.private_key) key.private_key = key.private_key.replace(/\\n/g, "\n");

  cachedAuth = new google.auth.GoogleAuth({
    credentials: { client_email: key.client_email, private_key: key.private_key },
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  return cachedAuth;
}

function getDrive() {
  return google.drive({ version: "v3", auth: getAuth() });
}

/** Shared Drives reject every call that omits these flags. */
function driveFlags() {
  const flags = { supportsAllDrives: true };
  if (env.storage.drive.sharedDriveId) {
    flags.driveId = env.storage.drive.sharedDriveId;
    flags.corpora = "drive";
    flags.includeItemsFromAllDrives = true;
  }
  return flags;
}

function bufferToStream(buffer) {
  return Readable.from(buffer);
}

const folderCache = new Map();

/**
 * Find-or-create a folder, cached in process.
 *
 * Files are laid out as:
 *   <root>/<org-slug>/<category>/
 * so an administrator opening Drive directly sees a sane structure and one
 * organization's files are never mixed into another's folder.
 */
async function ensureFolder(name, parentId) {
  const cacheKey = `${parentId || "root"}::${name}`;
  if (folderCache.has(cacheKey)) return folderCache.get(cacheKey);

  const drive = getDrive();
  const parent = parentId || env.storage.drive.rootFolderId || null;

  const clauses = [
    `mimeType='${FOLDER_MIME}'`,
    `name='${name.replace(/'/g, "\\'")}'`,
    "trashed=false",
  ];
  if (parent) clauses.push(`'${parent}' in parents`);

  const search = await drive.files.list({
    q: clauses.join(" and "),
    fields: "files(id,name)",
    pageSize: 1,
    ...driveFlags(),
  });

  let id = search.data.files && search.data.files[0] && search.data.files[0].id;

  if (!id) {
    const created = await drive.files.create({
      requestBody: {
        name,
        mimeType: FOLDER_MIME,
        parents: parent ? [parent] : undefined,
      },
      fields: "id",
      supportsAllDrives: true,
    });
    id = created.data.id;
  }

  folderCache.set(cacheKey, id);
  return id;
}

/** Resolve (and create if needed) the folder for one org + category. */
async function resolveFolder({ orgFolderName, category }) {
  const root = env.storage.drive.rootFolderId || null;
  const orgFolder = await ensureFolder(orgFolderName, root);
  if (!category) return orgFolder;
  return ensureFolder(category, orgFolder);
}

async function upload({ buffer, fileName, mimeType, orgFolderName, category, visibility }) {
  const drive = getDrive();
  const parent = await resolveFolder({ orgFolderName, category });

  const created = await drive.files.create({
    requestBody: { name: fileName, mimeType, parents: parent ? [parent] : undefined },
    media: { mimeType, body: bufferToStream(buffer) },
    fields: "id,name,mimeType,size,webViewLink,createdTime",
    supportsAllDrives: true,
  });

  const fileId = created.data.id;

  if (visibility === "public") {
    await drive.permissions.create({
      fileId,
      supportsAllDrives: true,
      requestBody: { role: "reader", type: "anyone" },
    });
  }

  return {
    providerId: fileId,
    fileName: created.data.name,
    mimeType: created.data.mimeType,
    size: Number(created.data.size || buffer.length),
    webViewLink: created.data.webViewLink || null,
  };
}

/** Flip an existing file between public and private after the fact. */
async function setVisibility(fileId, visibility) {
  const drive = getDrive();
  if (visibility === "public") {
    await drive.permissions.create({
      fileId,
      supportsAllDrives: true,
      requestBody: { role: "reader", type: "anyone" },
    });
    return;
  }
  const list = await drive.permissions.list({
    fileId,
    fields: "permissions(id,type,role)",
    supportsAllDrives: true,
  });
  for (const p of list.data.permissions || []) {
    if (p.type === "anyone") {
      await drive.permissions.delete({ fileId, permissionId: p.id, supportsAllDrives: true });
    }
  }
}

/**
 * Stream a file's bytes. Used by the authenticated proxy route — this is the
 * ONLY way private documents reach a browser.
 */
async function stream(fileId) {
  const drive = getDrive();

  const fetchOnce = async () => {
    const [content, meta] = await Promise.all([
      drive.files.get(
        { fileId, alt: "media", supportsAllDrives: true },
        { responseType: "stream" }
      ),
      drive.files
        .get({ fileId, fields: "name,mimeType,size", supportsAllDrives: true })
        .catch(() => null),
    ]);
    return {
      stream: content.data,
      mimeType:
        (meta && meta.data.mimeType) ||
        content.headers["content-type"] ||
        "application/octet-stream",
      fileName: (meta && meta.data.name) || null,
      size: meta && meta.data.size ? Number(meta.data.size) : null,
    };
  };

  try {
    return await fetchOnce();
  } catch (err) {
    const status = err.code || (err.response && err.response.status);
    // Retry transient Drive failures only. A 404/403 is a real answer and
    // retrying it just doubles the latency of an error response.
    if (status === 429 || status === 500 || status === 503) {
      await new Promise((r) => setTimeout(r, 400));
      return fetchOnce();
    }
    throw err;
  }
}

async function remove(fileId) {
  const drive = getDrive();
  // Trash rather than delete: HR documents are subject to retention rules and
  // an accidental delete must be recoverable.
  await drive.files.update({
    fileId,
    requestBody: { trashed: true },
    supportsAllDrives: true,
  });
}

async function getMetadata(fileId) {
  const drive = getDrive();
  const res = await drive.files.get({
    fileId,
    fields: "id,name,mimeType,size,trashed,createdTime,modifiedTime",
    supportsAllDrives: true,
  });
  return res.data;
}

async function healthCheck() {
  try {
    const drive = getDrive();
    await drive.about.get({ fields: "user(emailAddress)" });
    return { ok: true };
  } catch (err) {
    logger.warn({ err }, "Drive health check failed");
    return { ok: false, reason: err.message };
  }
}

module.exports = {
  name: "drive",
  upload,
  stream,
  remove,
  setVisibility,
  getMetadata,
  ensureFolder,
  healthCheck,
};
