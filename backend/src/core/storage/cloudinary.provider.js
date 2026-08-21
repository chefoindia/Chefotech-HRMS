"use strict";

const crypto = require("node:crypto");
const { Readable } = require("node:stream");
const { env } = require("../../config/env");
const { AppError } = require("../errors/AppError");
const { logger } = require("../../config/logger");

/**
 * Cloudinary provider — the store for images.
 *
 * Drive is a good filing cabinet and a poor image CDN: every render is a
 * round trip to lh3, there is no resizing beyond a width hint, no modern
 * format negotiation, and a logo on the sidebar of every page pays that cost
 * on every page. Cloudinary is a CDN with transformations in the URL, so an
 * avatar can be requested at exactly the size the layout uses, in whatever
 * format the requesting browser prefers, and is then served from an edge
 * cache. Documents stay in Drive, where per-file access control and the
 * customer's own retention rules matter more than render latency.
 *
 * Uploads are signed server-side. An unsigned preset would let anyone holding
 * the cloud name upload into the tenant's account, which is a bill and a
 * content-moderation problem rather than an inconvenience.
 *
 * Talks to the REST API over fetch rather than pulling in the SDK: the whole
 * surface used here is two endpoints and an SHA-1, and a dependency that ships
 * its own HTTP stack is not worth it for that.
 */

const API_BASE = "https://api.cloudinary.com/v1_1";
const RENDER_BASE = "https://res.cloudinary.com";

function config() {
  const { cloudName, apiKey, apiSecret } = env.storage.cloudinary;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new AppError("STORAGE_ERROR", {
      message:
        "Image storage is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.",
    });
  }
  return { cloudName, apiKey, apiSecret };
}

function isConfigured() {
  const { cloudName, apiKey, apiSecret } = env.storage.cloudinary;
  return Boolean(cloudName && apiKey && apiSecret);
}

/**
 * Cloudinary's signature: the signed parameters sorted by key, joined as a
 * query string, with the API secret appended, hashed with SHA-1. `file`,
 * `api_key` and `resource_type` are never part of it.
 */
function sign(params, apiSecret) {
  const canonical = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== "")
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return crypto.createHash("sha1").update(canonical + apiSecret).digest("hex");
}

/**
 * SVG is an executable document. Cloudinary will happily store and serve one,
 * and a logo upload is a route an ordinary HR admin can reach — so SVG stays
 * on the private, proxied path where it is served as a download, and never
 * becomes a same-origin script on a customer's dashboard.
 */
function accepts(mimeType) {
  return String(mimeType || "").startsWith("image/") && mimeType !== "image/svg+xml";
}

/**
 * Everything for one tenant lives under one folder, so a tenant's images can
 * be listed, migrated or purged as a unit without a database scan.
 */
function folderFor(orgFolderName, category) {
  const safe = String(orgFolderName || "org").replace(/[^a-zA-Z0-9_-]/g, "-");
  const bucket = String(category || "other").replace(/[^a-zA-Z0-9_-]/g, "-");
  return `${env.storage.cloudinary.folder}/${safe}/${bucket}`;
}

async function upload({ buffer, fileName, mimeType, orgFolderName, category }) {
  const { cloudName, apiKey, apiSecret } = config();

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = folderFor(orgFolderName, category);
  const signed = {
    folder,
    timestamp,
    // Never trust the uploader's word on the type: Cloudinary re-derives it
    // from the bytes, and a mismatch means the file is not what it claims.
    unique_filename: "true",
    overwrite: "false",
  };

  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimeType }), fileName);
  form.append("api_key", apiKey);
  for (const [key, value] of Object.entries(signed)) form.append(key, String(value));
  form.append("signature", sign(signed, apiSecret));

  const response = await fetch(`${API_BASE}/${cloudName}/image/upload`, {
    method: "POST",
    body: form,
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    // The API key is in scope here; log the reason, never the credentials.
    logger.error(
      { status: response.status, reason: body?.error?.message },
      "Cloudinary upload rejected"
    );
    throw new AppError("STORAGE_ERROR", {
      message: body?.error?.message || "The image could not be uploaded.",
    });
  }

  return {
    providerId: body.public_id,
    fileName,
    mimeType: body.format ? `image/${body.format}` : mimeType,
    size: body.bytes || buffer.length,
    webViewLink: body.secure_url || null,
    // Kept so a render URL can be rebuilt without another API call, and so a
    // later delete can be signed correctly.
    providerMeta: {
      version: body.version,
      format: body.format,
      width: body.width,
      height: body.height,
    },
  };
}

/**
 * A delivery URL with the transformation baked in.
 *
 * `f_auto` negotiates AVIF/WebP per browser, `q_auto` picks a quality that
 * holds up at that size, and `c_limit` never enlarges a small source — asking
 * for a 1200px logo should not upscale a 200px file into a blurry one.
 */
function renderUrl(publicId, { width, height, crop = "limit", format } = {}) {
  if (!publicId) return null;
  const { cloudName } = env.storage.cloudinary;
  if (!cloudName) return null;

  const parts = ["f_auto", "q_auto"];
  if (width) parts.push(`w_${Math.round(width)}`);
  if (height) parts.push(`h_${Math.round(height)}`);
  if (width || height) parts.push(`c_${crop}`);
  if (crop === "fill") parts.push("g_auto");

  const suffix = format ? `.${format}` : "";
  return `${RENDER_BASE}/${cloudName}/image/upload/${parts.join(",")}/${publicId}${suffix}`;
}

/**
 * Stream the stored bytes back, for the authenticated proxy path.
 *
 * Public images are served straight from the CDN and never come through here;
 * this exists so that an image whose visibility is later tightened, or a
 * tenant on a plan without public assets, still has a working read path.
 */
async function stream(id) {
  const url = renderUrl(id);
  if (!url) throw new AppError("STORAGE_ERROR", { message: "Image store is not configured." });

  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new AppError("NOT_FOUND", { message: "The image could not be read." });
  }

  return {
    stream: Readable.fromWeb(response.body),
    mimeType: response.headers.get("content-type") || "image/jpeg",
    fileName: String(id).split("/").pop(),
    size: Number(response.headers.get("content-length")) || null,
  };
}

async function remove(id) {
  const { cloudName, apiKey, apiSecret } = config();
  const timestamp = Math.floor(Date.now() / 1000);
  const signed = { public_id: id, timestamp };

  const form = new FormData();
  form.append("public_id", id);
  form.append("timestamp", String(timestamp));
  form.append("api_key", apiKey);
  form.append("signature", sign(signed, apiSecret));

  const response = await fetch(`${API_BASE}/${cloudName}/image/destroy`, {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    logger.warn({ status: response.status, reason: body?.error?.message }, "Cloudinary delete failed");
  }
}

/**
 * Cloudinary has no per-file ACL in the way Drive does — delivery type is
 * fixed at upload. Public images are the only thing routed here, so there is
 * nothing to toggle; the facade calls this uniformly across providers.
 */
async function setVisibility() {
  /* no-op */
}

async function getMetadata(id) {
  return { providerId: id, url: renderUrl(id) };
}

async function healthCheck() {
  if (!isConfigured()) return { ok: false, reason: "Cloudinary credentials are not set" };
  try {
    const { cloudName, apiKey, apiSecret } = config();
    // `ping` is the cheapest authenticated call the API offers.
    const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");
    const response = await fetch(`${API_BASE}/${cloudName}/ping`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    return response.ok ? { ok: true } : { ok: false, reason: `HTTP ${response.status}` };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

module.exports = {
  name: "cloudinary",
  accepts,
  isConfigured,
  upload,
  stream,
  remove,
  setVisibility,
  getMetadata,
  healthCheck,
  renderUrl,
};
