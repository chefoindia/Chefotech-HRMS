"use strict";

const crypto = require("node:crypto");
const { ApiKey, Webhook, WebhookDelivery } = require("./integration.model");
const secretBox = require("../../core/security/secretBox");
const eventBus = require("../../core/events/eventBus");
const queue = require("../../core/jobs/queue");
const { TEMPLATES } = require("../notifications/notificationTemplates");
const { isValidPermission } = require("../../core/rbac/permissions");
const { AppError } = require("../../core/errors/AppError");
const audit = require("../../core/audit/audit.service");
const tenant = require("../../core/tenancy/tenantContext");
const { logger } = require("../../config/logger");
const { env } = require("../../config/env");

/** Integrations. See integration.model.js. */

// ── API keys ────────────────────────────────────────────────────────────────

function hashKey(plain) {
  return crypto.createHash("sha256").update(String(plain)).digest("hex");
}

/**
 * Mint a key. The scopes may not exceed what the creator themselves holds,
 * so a key is never a way to escalate.
 */
async function createApiKey({ name, scopes, expiresAt }, auth, req) {
  const held = new Set(auth.permissions || []);
  const invalid = (scopes || []).filter((s) => !isValidPermission(s));
  if (invalid.length) throw AppError.badRequest(`Unknown permissions: ${invalid.join(", ")}`);
  const beyond = (scopes || []).filter((s) => !held.has(s));
  if (beyond.length) throw AppError.forbidden(`You cannot grant a key permissions you do not hold yourself: ${beyond.join(", ")}`);
  if (!(scopes || []).length) throw AppError.badRequest("Choose at least one permission for the key.");

  const secret = crypto.randomBytes(24).toString("base64url");
  const prefix = `ct_${env.isProd ? "live" : "test"}_${crypto.randomBytes(3).toString("hex")}`;
  const plain = `${prefix}_${secret}`;
  const key = await ApiKey.create({ name, prefix, hash: hashKey(plain), scopes, expiresAt: expiresAt ? new Date(expiresAt) : null, createdBy: auth.userId });
  await audit.record({ action: "integration.api_key_created", entityType: "ApiKey", entityId: key._id, entityLabel: name, after: { scopes, expiresAt }, severity: "warning" }, req);
  return { key: shapeKey(key.toObject()), plainKey: plain };
}

async function listApiKeys() {
  return (await ApiKey.find({}).populate("createdBy", "firstName lastName").sort({ createdAt: -1 }).lean()).map(shapeKey);
}

async function revokeApiKey(id, req) {
  const key = await ApiKey.findById(id);
  if (!key) throw AppError.notFound("API key");
  key.revokedAt = new Date();
  key.revokedBy = tenant.getUserId();
  await key.save();
  await audit.record({ action: "integration.api_key_revoked", entityType: "ApiKey", entityId: key._id, entityLabel: key.name, severity: "warning" }, req);
  return shapeKey(key.toObject());
}

/** Resolve a presented key to an identity. Used by the authenticate middleware. */
async function resolveApiKey(plain, ip) {
  if (!plain || !/^ct_(live|test)_[a-f0-9]{6}_[A-Za-z0-9_-]{20,}$/.test(plain)) return null;
  const key = await tenant.runAsSystem(() => ApiKey.findOne({ hash: hashKey(plain) }).setOptions({ bypassTenant: true }).lean(), "integration.api-key");
  if (!key || key.revokedAt) return null;
  if (key.expiresAt && key.expiresAt < new Date()) return null;
  tenant
    .runAsSystem(() => ApiKey.updateOne({ _id: key._id }, { $set: { lastUsedAt: new Date(), lastUsedIp: ip || null }, $inc: { useCount: 1 } }).setOptions({ bypassTenant: true }), "integration.api-key")
    .catch(() => {});
  return key;
}

function shapeKey(k) {
  return {
    id: String(k._id),
    name: k.name,
    prefix: k.prefix,
    scopes: k.scopes,
    expiresAt: k.expiresAt,
    isExpired: Boolean(k.expiresAt && new Date(k.expiresAt) < new Date()),
    lastUsedAt: k.lastUsedAt,
    lastUsedIp: k.lastUsedIp,
    useCount: k.useCount || 0,
    revokedAt: k.revokedAt,
    createdBy: k.createdBy && k.createdBy.firstName ? [k.createdBy.firstName, k.createdBy.lastName].filter(Boolean).join(" ") : null,
    createdAt: k.createdAt,
  };
}

// ── Webhooks ────────────────────────────────────────────────────────────────

/** Every event the platform emits, grouped, for the subscription picker. */
function eventCatalog() {
  const events = new Map();
  for (const [key, t] of Object.entries(TEMPLATES)) {
    if (!events.has(t.event)) events.set(t.event, { event: t.event, group: t.event.split(".")[0], examples: [] });
    events.get(t.event).examples.push(key);
  }
  return [...events.values()].sort((a, b) => a.event.localeCompare(b.event));
}

async function createWebhook({ name, url, events }, req) {
  assertUrl(url);
  const secret = `whsec_${crypto.randomBytes(24).toString("base64url")}`;
  const webhook = await Webhook.create({ name, url, secret: JSON.stringify(secretBox.encrypt(secret)), events: events || [], createdBy: tenant.getUserId() });
  await audit.record({ action: "integration.webhook_created", entityType: "Webhook", entityId: webhook._id, entityLabel: name, after: { url, events }, severity: "warning" }, req);
  return { webhook: shapeWebhook(webhook.toObject()), secret };
}

function assertUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw AppError.badRequest("Enter a full URL, starting with https://");
  }
  if (parsed.protocol !== "https:" && !(env.isDev || env.isTest)) throw AppError.badRequest("Webhook URLs must use https.");
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|\[::1\])/.test(parsed.hostname) && !(env.isDev || env.isTest)) throw AppError.badRequest("Webhooks cannot point at private addresses.");
}

async function updateWebhook(id, data, req) {
  const webhook = await Webhook.findById(id);
  if (!webhook) throw AppError.notFound("Webhook");
  if (data.url) assertUrl(data.url);
  for (const key of ["name", "url", "events", "isActive"]) if (data[key] !== undefined) webhook[key] = data[key];
  if (data.isActive) {
    webhook.consecutiveFailures = 0;
    webhook.disabledReason = null;
  }
  await webhook.save();
  await audit.record({ action: "integration.webhook_updated", entityType: "Webhook", entityId: webhook._id, entityLabel: webhook.name, after: { url: webhook.url, events: webhook.events, isActive: webhook.isActive }, severity: "notice" }, req);
  return shapeWebhook(webhook.toObject());
}

async function rotateSecret(id, req) {
  const webhook = await Webhook.findById(id);
  if (!webhook) throw AppError.notFound("Webhook");
  const secret = `whsec_${crypto.randomBytes(24).toString("base64url")}`;
  webhook.secret = JSON.stringify(secretBox.encrypt(secret));
  await webhook.save();
  await audit.record({ action: "integration.webhook_secret_rotated", entityType: "Webhook", entityId: webhook._id, entityLabel: webhook.name, severity: "warning" }, req);
  return { secret };
}

async function deleteWebhook(id, req) {
  const webhook = await Webhook.findById(id);
  if (!webhook) throw AppError.notFound("Webhook");
  await Webhook.deleteOne({ _id: id });
  await WebhookDelivery.deleteMany({ webhookId: id });
  await audit.record({ action: "integration.webhook_deleted", entityType: "Webhook", entityId: id, entityLabel: webhook.name, severity: "warning" }, req);
  return { id: String(id), deleted: true };
}

async function listWebhooks() {
  return (await Webhook.find({}).sort({ createdAt: -1 }).lean()).map(shapeWebhook);
}

async function listDeliveries(webhookId, { limit = 50 } = {}) {
  const rows = await WebhookDelivery.find({ webhookId }).sort({ createdAt: -1 }).limit(limit).lean();
  return rows.map((d) => ({ id: String(d._id), event: d.event, status: d.status, attempts: d.attempts, responseStatus: d.responseStatus, error: d.error, durationMs: d.durationMs, deliveredAt: d.deliveredAt, createdAt: d.createdAt, payload: d.payload }));
}

/** Send a synthetic event so the receiver can be checked end to end. */
async function test(id, req) {
  const webhook = await Webhook.findById(id).lean();
  if (!webhook) throw AppError.notFound("Webhook");
  const delivery = await WebhookDelivery.create({ webhookId: webhook._id, event: "webhook.test", payload: { event: "webhook.test", organizationId: String(tenant.requireOrganizationId()), sentAt: new Date().toISOString(), data: { message: "Hello from ChefoTech HRMS" } } });
  const result = await deliver(String(delivery._id), { rethrow: false });
  void req;
  return { ok: result.status === "delivered", responseStatus: result.responseStatus, error: result.error };
}

function shapeWebhook(w) {
  return { id: String(w._id), name: w.name, url: w.url, events: w.events, isActive: w.isActive, consecutiveFailures: w.consecutiveFailures || 0, lastDeliveredAt: w.lastDeliveredAt, lastStatus: w.lastStatus, lastError: w.lastError, disabledReason: w.disabledReason, createdAt: w.createdAt };
}

/**
 * Fan out one emitted event to every subscribed webhook of that
 * organization. Deliveries are rows, so a failure is visible and retryable.
 */
async function fanOut(event, payload) {
  const organizationId = payload && payload.organizationId;
  if (!organizationId) return 0;
  return tenant.runWithTenant(organizationId, async () => {
    const hooks = await Webhook.find({ isActive: true, events: { $in: [event, "*"] } }).select("_id").lean();
    for (const hook of hooks) {
      const delivery = await WebhookDelivery.create({ webhookId: hook._id, event, payload: { event, organizationId: String(organizationId), sentAt: new Date().toISOString(), data: payload.data || {}, entity: payload.entity || null } });
      await queue.enqueue("webhooks.deliver", { deliveryId: String(delivery._id) }, { organizationId, priority: 1 });
    }
    return hooks.length;
  });
}

/** The job: POST the payload, signed; throw on failure so the queue retries. */
async function deliver(deliveryId, { rethrow = true } = {}) {
  const delivery = await WebhookDelivery.findById(deliveryId);
  if (!delivery || delivery.status === "delivered") return delivery;
  const webhook = await Webhook.findById(delivery.webhookId);
  if (!webhook) return delivery;

  let secret;
  try {
    secret = secretBox.decrypt(JSON.parse(webhook.secret));
  } catch {
    secret = "";
  }
  const body = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  const started = Date.now();
  delivery.attempts += 1;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const response = await fetch(webhook.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "ChefoTech-HRMS-Webhooks/1.0", "X-Chefotech-Event": delivery.event, "X-Chefotech-Delivery": String(delivery._id), "X-Chefotech-Timestamp": String(timestamp), "X-Chefotech-Signature": `v1=${signature}` },
      body,
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    delivery.responseStatus = response.status;
    delivery.responseBody = (await response.text().catch(() => "")).slice(0, 500);
    delivery.durationMs = Date.now() - started;
    if (!response.ok) throw new Error(`Receiver answered ${response.status}`);
    delivery.status = "delivered";
    delivery.deliveredAt = new Date();
    delivery.error = null;
    await delivery.save();
    await Webhook.updateOne({ _id: webhook._id }, { $set: { consecutiveFailures: 0, lastDeliveredAt: new Date(), lastStatus: response.status, lastError: null } });
    return delivery;
  } catch (err) {
    delivery.error = err.name === "AbortError" ? "Timed out after 10 seconds" : err.message;
    delivery.durationMs = Date.now() - started;
    delivery.status = delivery.attempts >= 5 ? "failed" : "pending";
    await delivery.save();
    const failures = (webhook.consecutiveFailures || 0) + 1;
    const update = { consecutiveFailures: failures, lastStatus: delivery.responseStatus, lastError: delivery.error };
    if (failures >= 20) Object.assign(update, { isActive: false, disabledReason: "Switched off after 20 consecutive failures" });
    await Webhook.updateOne({ _id: webhook._id }, { $set: update });
    logger.warn({ err, webhookId: String(webhook._id), attempt: delivery.attempts }, "Webhook delivery failed");
    if (rethrow && delivery.status === "pending") throw err;
    return delivery;
  }
}

/** Wire every emitted event to the fan-out. Called once at boot. */
let subscribed = false;
function subscribe() {
  if (subscribed) return;
  subscribed = true;
  const seen = new Set();
  for (const t of Object.values(TEMPLATES)) {
    if (seen.has(t.event)) continue;
    seen.add(t.event);
    eventBus.on(t.event, (payload) => fanOut(t.event, payload).catch((err) => logger.warn({ err, event: t.event }, "Webhook fan-out failed")));
  }
}

module.exports = { createApiKey, listApiKeys, revokeApiKey, resolveApiKey, eventCatalog, createWebhook, updateWebhook, rotateSecret, deleteWebhook, listWebhooks, listDeliveries, test, fanOut, deliver, subscribe, ApiKey, Webhook, WebhookDelivery };
