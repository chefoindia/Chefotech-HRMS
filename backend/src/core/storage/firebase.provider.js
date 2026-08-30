"use strict";

const crypto = require("node:crypto");
const { Readable } = require("node:stream");
const { google } = require("googleapis");
const { env } = require("../../config/env");
const { AppError } = require("../errors/AppError");
const { logger } = require("../../config/logger");

/**
 * Firebase Storage provider.
 *
 * Firebase Storage is Google Cloud Storage with a Firebase-shaped door on the
 * front, so this talks to the GCS JSON API directly with the same service
 * account the rest of the Google integration uses. That means no new
 * dependency: `googleapis` is already here for Drive and carries the JWT
 * signing this needs.
 *
 * Why this exists alongside Cloudinary: Cloudinary's free tier does not allow
 * the upload volume an HRMS generates, and an image store that stops accepting
 * uploads mid-onboarding is worse than a slower one. Firebase's free tier is
 * sized for exactly this.
 *
 * What it does NOT do, and the honest trade against Cloudinary: there are no
 * URL transformations. Cloudinary could resize and re-encode per request from
 * the URL alone; GCS serves the bytes it was given. `renderUrl` therefore
 * ignores width and height rather than pretending — asking for a 64px avatar
 * returns the full-size object. If image weight becomes a problem, the fix is
 * to resize on upload, not to add a query parameter here that does nothing.
 *
 * ── Visibility ──────────────────────────────────────────────────────────────
 *
 * Public objects get a GCS ACL entry for `allUsers` and are served straight
 * from storage.googleapis.com, which is what makes a tenant logo render in an
 * <img> without a round trip through the API. Everything else stays private
 * and is streamed by `stream()` only after the caller's tenant and permissions
 * have been checked, exactly as the Drive provider does — a leaked object path
 * on its own is worthless.
 */

const GCS_API = "https://storage.googleapis.com/storage/v1";
const GCS_UPLOAD = "https://storage.googleapis.com/upload/storage/v1";
const GCS_PUBLIC = "https://storage.googleapis.com";

let cachedAuth = null;

function serviceAccount() {
  const raw = env.storage.firebase.serviceAccountKey;
  if (!raw) return null;

  let key;
  try {
    // Accepts either raw JSON or the base64 form, because a private key with
    // real newlines is painful to paste into a hosting dashboard's env editor
    // and base64 is how it usually ends up there.
    const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    key = JSON.parse(text);
  } catch {
    return null;
  }

  // dotenv keeps the private key's newlines as the literal characters \ and n.
  // The RSA signer needs real newlines or every request fails with
  // "error:1E08010C:DECODER routines::unsupported".
  if (key.private_key) key.private_key = key.private_key.replace(/\\n/g, "\n");
  return key;
}

function bucketName() {
  const configured = env.storage.firebase.bucket;
  if (configured) return configured;

  // Firebase's default bucket is <project-id>.appspot.com, so a project id is
  // enough to work without a second setting.
  const key = serviceAccount();
  return key && key.project_id ? `${key.project_id}.appspot.com` : "";
}

function isConfigured() {
  return Boolean(serviceAccount() && bucketName());
}

function getAuth() {
  if (cachedAuth) return cachedAuth;

  const key = serviceAccount();
  if (!key) {
    throw new AppError("STORAGE_ERROR", {
      message: "Firebase storage is not configured.",
      meta: { hint: "Set FIREBASE_SERVICE_ACCOUNT_KEY (raw JSON or base64)." },
    });
  }

  cachedAuth = new google.auth.GoogleAuth({
    credentials: { client_email: key.client_email, private_key: key.private_key },
    scopes: ["https://www.googleapis.com/auth/devstorage.read_write"],
  });
  return cachedAuth;
}

async function authHeaders() {
  const client = await getAuth().getClient();
  const { token } = await client.getAccessToken();
  if (!token) {
    throw new AppError("STORAGE_ERROR", { message: "Could not authenticate with Firebase storage." });
  }
  return { Authorization: `Bearer ${token}` };
}

/**
 * Accepts anything.
 *
 * Unlike Cloudinary this is a general object store, not an image pipeline, so
 * it can hold documents as well. The category allow-lists in storage.service
 * still decide what a given upload field will take — this only says the
 * provider is capable.
 */
function accepts() {
  return true;
}

/**
 * Everything for one tenant lives under one prefix, so a tenant's files can be
 * listed, migrated or purged as a unit without a database scan.
 */
function objectPath(orgFolderName, category, fileName) {
  const safe = String(orgFolderName || "org").replace(/[^a-zA-Z0-9_-]/g, "-");
  const bucketFolder = String(category || "other").replace(/[^a-zA-Z0-9_-]/g, "-");
  // A random segment keeps two uploads of "photo.jpg" from colliding, and
  // keeps an object path from being guessable for private files.
  const unique = crypto.randomBytes(8).toString("hex");
  const clean = String(fileName || "file").replace(/[^a-zA-Z0-9._-]/g, "-").slice(-120);
  return `${env.storage.firebase.folder}/${safe}/${bucketFolder}/${unique}-${clean}`;
}

async function upload({ buffer, fileName, mimeType, orgFolderName, category, isPublic = false }) {
  if (!isConfigured()) {
    throw new AppError("STORAGE_ERROR", { message: "Firebase storage is not configured." });
  }

  const bucket = bucketName();
  const name = objectPath(orgFolderName, category, fileName);
  const headers = await authHeaders();

  const url =
    `${GCS_UPLOAD}/b/${encodeURIComponent(bucket)}/o` +
    `?uploadType=media&name=${encodeURIComponent(name)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { ...headers, "Content-Type": mimeType || "application/octet-stream" },
    body: buffer,
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    // The access token is in scope here; log the reason, never the credential.
    logger.error(
      { status: response.status, reason: body?.error?.message },
      "Firebase storage upload rejected"
    );
    throw new AppError("STORAGE_ERROR", {
      message: body?.error?.message || "The file could not be uploaded.",
    });
  }

  if (isPublic) await setVisibility(name, true);

  return {
    providerId: name,
    fileName,
    mimeType: body.contentType || mimeType,
    size: Number(body.size) || buffer.length,
    webViewLink: isPublic ? publicUrl(name) : null,
    providerMeta: {
      bucket,
      generation: body.generation,
      // Kept so a later integrity check does not need to re-download.
      md5: body.md5Hash || null,
    },
  };
}

/** The unauthenticated URL for an object that has been made public. */
function publicUrl(name) {
  const bucket = bucketName();
  if (!bucket || !name) return null;
  return `${GCS_PUBLIC}/${bucket}/${encodeURI(name)}`;
}

/**
 * The render URL.
 *
 * Width and height are accepted and deliberately ignored: GCS has no
 * transformation layer, and silently returning a full-size object for a
 * request that asked for 64px is better than inventing a parameter that looks
 * like it works. Callers that genuinely need a thumbnail should store one.
 */
function renderUrl(id) {
  return publicUrl(id);
}

async function stream(id) {
  if (!isConfigured()) {
    throw new AppError("STORAGE_ERROR", { message: "Firebase storage is not configured." });
  }

  const bucket = bucketName();
  const headers = await authHeaders();
  const url = `${GCS_API}/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(id)}?alt=media`;

  const response = await fetch(url, { headers });
  if (!response.ok || !response.body) {
    throw new AppError("NOT_FOUND", { message: "The file could not be read." });
  }

  return {
    stream: Readable.fromWeb(response.body),
    mimeType: response.headers.get("content-type") || "application/octet-stream",
    fileName: String(id).split("/").pop(),
    size: Number(response.headers.get("content-length")) || null,
  };
}

async function remove(id) {
  if (!isConfigured()) return;

  const bucket = bucketName();
  const headers = await authHeaders();
  const response = await fetch(
    `${GCS_API}/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(id)}`,
    { method: "DELETE", headers }
  );

  // 404 means it is already gone, which is the state the caller wanted.
  if (!response.ok && response.status !== 404) {
    const body = await response.json().catch(() => ({}));
    logger.warn(
      { status: response.status, reason: body?.error?.message },
      "Firebase storage delete failed"
    );
  }
}

/**
 * Grant or revoke anonymous read.
 *
 * This is the whole of the public/private distinction for this provider, so it
 * is the one call that must not silently no-op — a document that stays public
 * after being marked private is a data leak, not a cosmetic bug.
 */
async function setVisibility(id, isPublic) {
  if (!isConfigured()) return;

  const bucket = bucketName();
  const headers = await authHeaders();
  const aclUrl =
    `${GCS_API}/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(id)}/acl` +
    (isPublic ? "" : "/allUsers");

  const response = await fetch(aclUrl, {
    method: isPublic ? "POST" : "DELETE",
    headers: { ...headers, "Content-Type": "application/json" },
    body: isPublic ? JSON.stringify({ entity: "allUsers", role: "READER" }) : undefined,
  });

  // Revoking something that was never public returns 404, which is fine.
  if (!response.ok && !(response.status === 404 && !isPublic)) {
    const body = await response.json().catch(() => ({}));
    const reason = body?.error?.message;

    // A uniform bucket-level access policy refuses per-object ACLs outright.
    // Failing loudly matters here: the caller believes it just made a file
    // public or private, and it did not.
    throw new AppError("STORAGE_ERROR", {
      message:
        reason && /uniform bucket-level access/i.test(reason)
          ? "This bucket uses uniform bucket-level access, so per-file visibility cannot be set. Turn it off in the Google Cloud console, or serve every file through the API."
          : reason || "The file's visibility could not be changed.",
    });
  }
}

async function getMetadata(id) {
  if (!isConfigured()) return { providerId: id, url: null };

  const bucket = bucketName();
  const headers = await authHeaders();
  const response = await fetch(
    `${GCS_API}/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(id)}`,
    { headers }
  );

  if (!response.ok) return { providerId: id, url: publicUrl(id) };

  const body = await response.json().catch(() => ({}));
  return {
    providerId: id,
    url: publicUrl(id),
    size: Number(body.size) || null,
    mimeType: body.contentType || null,
    updatedAt: body.updated || null,
  };
}

async function healthCheck() {
  if (!isConfigured()) {
    return { ok: false, reason: "Firebase service account or bucket is not set" };
  }
  try {
    const bucket = bucketName();
    const headers = await authHeaders();
    // Reading the bucket's own metadata is the cheapest authenticated call
    // that proves both the credential and the bucket name are right.
    const response = await fetch(`${GCS_API}/b/${encodeURIComponent(bucket)}`, { headers });
    if (response.ok) return { ok: true };

    const body = await response.json().catch(() => ({}));
    return { ok: false, reason: body?.error?.message || `HTTP ${response.status}` };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

module.exports = {
  name: "firebase",
  accepts,
  isConfigured,
  upload,
  stream,
  remove,
  setVisibility,
  getMetadata,
  healthCheck,
  renderUrl,
  // Exported for the health route and for tests that need to assert which
  // bucket a deployment is actually pointed at.
  bucketName,
};
