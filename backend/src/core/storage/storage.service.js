"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const StoredFile = require("./storedFile.model");
const driveProvider = require("./drive.provider");
const cloudinaryProvider = require("./cloudinary.provider");
const localProvider = require("./local.provider");
const { env } = require("../../config/env");
const { AppError } = require("../errors/AppError");
const { logger } = require("../../config/logger");
const tenant = require("../tenancy/tenantContext");

/**
 * Storage facade. Modules call this; nothing outside `core/storage` knows
 * whether the bytes ended up in Drive or on disk.
 */

const PROVIDERS = { drive: driveProvider, local: localProvider, cloudinary: cloudinaryProvider };

function provider(name) {
  const p = PROVIDERS[name || env.storage.driver];
  if (!p) throw new AppError("STORAGE_ERROR", { message: "No file store is configured." });
  return p;
}

/**
 * Which store a new upload belongs in.
 *
 * Routing is by what the file IS, not by which module asked: a photo uploaded
 * as an employee document is still a photo, and a store chosen per calling
 * module would drift the moment a new module was added. Images go to the CDN,
 * everything else to the document store.
 *
 * Falls back rather than failing when the image store is unconfigured — a
 * missing Cloudinary key should degrade a logo to a slower render path, not
 * break the upload and block onboarding.
 */
function providerForUpload({ mimeType }) {
  const wanted = env.storage.imageDriver;
  if (!wanted || wanted === env.storage.driver) return provider();

  const candidate = PROVIDERS[wanted];
  if (!candidate) return provider();
  if (typeof candidate.accepts === "function" && !candidate.accepts(mimeType)) return provider();
  if (typeof candidate.isConfigured === "function" && !candidate.isConfigured()) {
    logger.warn(
      { driver: wanted },
      "Image store is not configured; falling back to the document store"
    );
    return provider();
  }
  return candidate;
}

/**
 * Upload allow-lists per category. A "profile photo" field that accepts a
 * .exe is how an HRMS becomes a malware host, so the type is checked against
 * what the category is actually for — not against a single global list.
 */
const ALLOWED_TYPES = {
  image: ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"],
  document: [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv",
    "text/plain",
  ],
};
ALLOWED_TYPES.any = [...ALLOWED_TYPES.image, ...ALLOWED_TYPES.document];

const CATEGORY_RULES = {
  branding: { types: "image", visibility: "public", maxBytes: 5 * 1024 * 1024 },
  avatar: { types: "image", visibility: "public", maxBytes: 5 * 1024 * 1024 },
  "employee-document": { types: "any", visibility: "private", maxBytes: 25 * 1024 * 1024 },
  "company-document": { types: "any", visibility: "private", maxBytes: 25 * 1024 * 1024 },
  payslip: { types: "document", visibility: "private", maxBytes: 10 * 1024 * 1024 },
  "generated-document": { types: "document", visibility: "private", maxBytes: 10 * 1024 * 1024 },
  import: { types: "document", visibility: "private", maxBytes: 20 * 1024 * 1024 },
  export: { types: "document", visibility: "private", maxBytes: 50 * 1024 * 1024 },
  attachment: { types: "any", visibility: "private", maxBytes: 25 * 1024 * 1024 },
  other: { types: "any", visibility: "private", maxBytes: 10 * 1024 * 1024 },
};

/**
 * SVG is an executable document — it can carry <script> and reach the user's
 * session if served same-origin. Uploads are accepted for logos, but the
 * proxy always serves them as a download with a restrictive CSP.
 */
const NEVER_INLINE = new Set(["image/svg+xml", "text/html", "application/xhtml+xml"]);

function sanitiseFileName(name) {
  const base = path.basename(String(name || "file"));
  return base
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180) || "file";
}

function assertUploadAllowed({ mimeType, size, category }) {
  const rule = CATEGORY_RULES[category] || CATEGORY_RULES.other;
  const allowed = ALLOWED_TYPES[rule.types];

  if (!allowed.includes(mimeType)) {
    throw AppError.badRequest(
      `Files of type ${mimeType} cannot be uploaded here.`,
      { allowed }
    );
  }
  if (size > Math.min(rule.maxBytes, env.storage.maxUploadBytes)) {
    throw new AppError("PAYLOAD_TOO_LARGE", {
      message: `This file is larger than the ${Math.round(rule.maxBytes / 1024 / 1024)}MB limit for ${category} uploads.`,
    });
  }
  return rule;
}

/**
 * Store a buffer and register it.
 *
 * @returns {Promise<StoredFile>} the registry document
 */
async function save({
  buffer,
  originalName,
  mimeType,
  category = "other",
  visibility,
  ownerType = null,
  ownerId = null,
  orgFolderName,
  metadata = {},
  uploadedBy = null,
}) {
  const rule = assertUploadAllowed({ mimeType, size: buffer.length, category });
  const finalVisibility = visibility || rule.visibility;

  const safeName = sanitiseFileName(originalName);
  const stamped = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${safeName}`;

  const target = providerForUpload({ mimeType });

  let uploaded;
  try {
    uploaded = await target.upload({
      buffer,
      fileName: stamped,
      mimeType,
      orgFolderName: orgFolderName || `org-${tenant.getOrganizationId()}`,
      category,
      visibility: finalVisibility,
    });
  } catch (err) {
    logger.error({ err, category }, "File upload failed");
    if (err instanceof AppError) throw err;
    throw new AppError("STORAGE_ERROR");
  }

  return StoredFile.create({
    provider: target.name,
    providerId: uploaded.providerId,
    fileName: uploaded.fileName,
    originalName: safeName,
    mimeType,
    size: uploaded.size,
    checksum: crypto.createHash("sha256").update(buffer).digest("hex"),
    category,
    visibility: finalVisibility,
    ownerType,
    ownerId,
    uploadedBy: uploadedBy || tenant.getUserId(),
    metadata: { ...metadata, ...(uploaded.providerMeta || {}) },
  });
}

/**
 * Public render URL for an image.
 *
 * Takes the stored-file document, never a bare provider id. That is
 * deliberate: the id alone does not say where the bytes are, and an earlier
 * version of this function took one and assumed Drive. Every caller then
 * produced a Drive URL for files sitting on local disk or on the CDN — the
 * upload reported success and the image rendered broken, because
 * lh3.googleusercontent.com has never heard of a local UUID. Requiring the
 * document makes that mistake unspellable.
 *
 * Google's lh3 host is the one Drive endpoint that behaves like a CDN: it
 * returns the image bytes directly with permissive CORS and honours a size
 * hint, so it works inside <img src> and next/image. drive.google.com/uc
 * answers an <img> request with an HTML consent page instead, which is why
 * every "why is my Drive image broken" thread ends there.
 */
function publicImageUrl(file, { width, height, apiPrefix = env.app.apiPrefix } = {}) {
  if (!file) return null;

  // Tolerate the old string form rather than returning a confidently wrong
  // URL: there is no provider to infer, so route through the proxy, which
  // works for every store.
  if (typeof file === "string") {
    logger.warn(
      { providerId: file },
      "publicImageUrl called with a bare provider id; pass the stored-file document"
    );
    return null;
  }

  const providerId = file.providerId;
  if (!providerId) return null;

  if (file.provider === "cloudinary") {
    // If the credentials were removed after the file was stored there is no
    // cloud name to build a URL from. Fall through to the proxy rather than
    // returning null, so an existing image keeps rendering.
    const cdn = cloudinaryProvider.renderUrl(providerId, { width, height });
    if (cdn) return cdn;
  }

  if (file.provider === "drive" && file.visibility === "public") {
    let size = "";
    if (width && height) size = `=w${width}-h${height}`;
    else if (width) size = `=w${width}`;
    else if (height) size = `=h${height}`;
    return `https://lh3.googleusercontent.com/d/${providerId}${size}`;
  }

  // Local disk, or a private Drive file: only the authenticated proxy can
  // serve these, and it needs the registry id rather than the provider's.
  const id = file._id || file.id;
  if (!id) return null;
  return `${env.app.publicApiUrl}${apiPrefix}/files/${id}/content${width ? `?w=${width}` : ""}`;
}

/** A thumbnail that works for non-image types too (PDF first page, etc). */
function thumbnailUrl(providerId, width = 400, from = "drive") {
  if (!providerId) return null;
  // `fill` rather than `limit` here: a thumbnail grid wants a predictable box,
  // and `g_auto` keeps the subject of the photo inside it.
  if (from === "cloudinary") {
    return cloudinaryProvider.renderUrl(providerId, { width, height: width, crop: "fill" });
  }
  return `https://drive.google.com/thumbnail?id=${providerId}&sz=w${width}`;
}

/**
 * Turn a registry document into the shape the frontend consumes.
 * Private files get a proxy path; public images get the lh3 URL and, as a
 * fallback for the occasional lh3 hiccup, the proxy path as well.
 */
function toPublicShape(file, { apiPrefix = env.app.apiPrefix } = {}) {
  if (!file) return null;
  const id = String(file._id || file.id);
  const proxyUrl = `${env.app.publicApiUrl}${apiPrefix}/files/${id}/content`;
  const isImage = String(file.mimeType || "").startsWith("image/");
  const onCdn = file.provider === "cloudinary";
  // Cloudinary delivery URLs are public by construction, so an image stored
  // there is renderable without the proxy regardless of the flag Drive would
  // have needed.
  const isPublic = onCdn || (file.visibility === "public" && file.provider === "drive");

  return {
    id,
    fileName: file.originalName || file.fileName,
    mimeType: file.mimeType,
    size: file.size,
    category: file.category,
    visibility: file.visibility,
    // Render target. lh3 for public Drive images, authenticated proxy for
    // anything private.
    url: isImage ? publicImageUrl(file, { width: 1200, apiPrefix }) || proxyUrl : proxyUrl,
    thumbnailUrl: isPublic
      ? thumbnailUrl(file.providerId, 400, file.provider)
      : `${proxyUrl}?w=400`,
    downloadUrl: `${proxyUrl}?download=1`,
    // Always available regardless of Drive's mood.
    proxyUrl,
    createdAt: file.createdAt,
  };
}

/** Fetch bytes for the proxy route. Caller has already authorised access. */
async function openStream(file) {
  try {
    return await provider(file.provider).stream(file.providerId);
  } catch (err) {
    logger.error({ err, fileId: String(file._id) }, "File stream failed");
    const status = err.code || (err.response && err.response.status);
    if (status === 404) throw AppError.notFound("File");
    throw new AppError("STORAGE_ERROR");
  }
}

async function destroy(file, userId) {
  try {
    await provider(file.provider).remove(file.providerId);
  } catch (err) {
    // The registry entry still goes away — an orphan in Drive is a housekeeping
    // problem, a stuck record in the UI is a user-facing one.
    logger.warn({ err, fileId: String(file._id) }, "Provider delete failed; soft-deleting record");
  }
  return file.softDelete(userId);
}

function shouldForceDownload(mimeType) {
  return NEVER_INLINE.has(mimeType);
}

/**
 * Both stores are reported. A green document store and a red image store is a
 * real and survivable state — uploads still work, images just render slower —
 * and collapsing that into one boolean hides it.
 */
async function healthCheck() {
  const documents = await provider().healthCheck();
  const imageDriver = env.storage.imageDriver;
  const images =
    imageDriver && imageDriver !== env.storage.driver && PROVIDERS[imageDriver]
      ? await PROVIDERS[imageDriver].healthCheck()
      : documents;
  return { ok: documents.ok, documents, images, driver: env.storage.driver, imageDriver };
}

module.exports = {
  save,
  openStream,
  destroy,
  toPublicShape,
  publicImageUrl,
  thumbnailUrl,
  shouldForceDownload,
  assertUploadAllowed,
  sanitiseFileName,
  healthCheck,
  CATEGORY_RULES,
  ALLOWED_TYPES,
  StoredFile,
};
