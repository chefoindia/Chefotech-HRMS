"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");

const { startDatabase, stopDatabase, clearDatabase } = require("../helpers/db");
const { createApp } = require("../../src/app");
const User = require("../../src/modules/users/user.model");
const Organization = require("../../src/modules/organizations/organization.model");
const organizationService = require("../../src/modules/organizations/organization.service");
const tenant = require("../../src/core/tenancy/tenantContext");
const queue = require("../../src/core/jobs/queue");
const integrations = require("../../src/modules/integrations/integration.service");
const notifications = require("../../src/modules/notifications/notification.service");
const recipients = require("../../src/modules/notifications/recipients");

/**
 * The two doors other systems use.
 *
 * An API key is a session for a machine: it carries a subset of its
 * creator's permissions, is refused everywhere a person would be, and dies
 * the moment it is revoked. A webhook is the platform talking back: every
 * event a notification template emits reaches subscribed receivers as a
 * signed POST, with the signature the receiver can verify.
 */

let server;
let baseUrl;
let receiver;
let receiverUrl;
const received = [];
const state = {};

test.before(async () => {
  await startDatabase();
  const app = createApp();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;

  receiver = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      received.push({ url: req.url, headers: req.headers, body });
      if (req.url === "/fail") {
        res.statusCode = 500;
        return res.end("no");
      }
      return res.end("ok");
    });
  });
  await new Promise((resolve) => receiver.listen(0, resolve));
  receiverUrl = `http://127.0.0.1:${receiver.address().port}`;

  integrations.subscribe();
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => receiver.close(resolve));
  await stopDatabase();
});

test.beforeEach(async () => {
  await clearDatabase();
  received.length = 0;

  const owner = new User({ email: "owner@integrations.test", firstName: "Dev", lastName: "Iyer", status: "active", emailVerifiedAt: new Date() });
  await owner.setPassword("Password@12345");
  await owner.save();
  state.owner = owner;
  const { organization } = await organizationService.provision({ name: "Integrations Co", ownerUserId: owner._id });
  state.organizationId = organization._id;

  const login = await api("POST", "/auth/login", { body: { email: "owner@integrations.test", password: "Password@12345" } });
  state.token = login.body.data.accessToken;
});

async function api(method, path, { token, apiKey, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(apiKey ? { "x-api-key": apiKey } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  return { status: response.status, body: parsed };
}

async function waitFor(check, { timeout = 4000, every = 50 } = {}) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, every));
  }
  return false;
}

async function drainAll() {
  let ran = 0;
  while (await queue.drainOnce()) ran += 1;
  return ran;
}

function verifySignature(entry, secret) {
  const timestamp = entry.headers["x-chefotech-timestamp"];
  const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${entry.body}`).digest("hex");
  return entry.headers["x-chefotech-signature"] === `v1=${expected}`;
}

test("an API key acts with only the scopes it was given, cannot manage integrations, and dies when revoked", async () => {
  const created = await api("POST", "/integrations/api-keys", { token: state.token, body: { name: "Payroll sync", scopes: ["employee.view"] } });
  assert.ok([200, 201].includes(created.status), JSON.stringify(created.body));
  const { key, plainKey } = created.body.data;
  assert.match(plainKey, /^ct_(live|test)_[a-f0-9]{6}_/);
  assert.equal(key.prefix, plainKey.slice(0, key.prefix.length));
  assert.deepEqual(key.scopes, ["employee.view"]);

  const listed = await api("GET", "/integrations/api-keys", { token: state.token });
  assert.equal(listed.body.data.length, 1);
  assert.ok(!JSON.stringify(listed.body).includes(plainKey), "the plain key is never listed again");

  const read = await api("GET", "/employees", { apiKey: plainKey });
  assert.equal(read.status, 200, JSON.stringify(read.body));

  const write = await api("POST", "/employees", { apiKey: plainKey, body: { personal: { firstName: "No", lastName: "Way" }, employment: { joiningDate: "2025-01-01" } } });
  assert.equal(write.status, 403, "a scope the key lacks is refused");

  const manage = await api("GET", "/integrations/api-keys", { apiKey: plainKey });
  assert.equal(manage.status, 403, "a key can never mint or list keys");

  const me = await api("GET", "/auth/me", { apiKey: plainKey });
  assert.ok([200, 401, 403].includes(me.status));

  const bogus = await api("GET", "/employees", { apiKey: "ct_live_abcdef_notarealkeyatallnotarealkey" });
  assert.equal(bogus.status, 401);

  const unknownScope = await api("POST", "/integrations/api-keys", { token: state.token, body: { name: "x", scopes: ["not.a.permission"] } });
  assert.ok([400, 403, 422].includes(unknownScope.status), JSON.stringify(unknownScope.body));

  const used = (await api("GET", "/integrations/api-keys", { token: state.token })).body.data[0];
  assert.ok(used.useCount >= 1, "use is counted");

  const revoked = await api("POST", `/integrations/api-keys/${key.id}/revoke`, { token: state.token });
  assert.equal(revoked.status, 200);
  const after = await api("GET", "/employees", { apiKey: plainKey });
  assert.equal(after.status, 401, "a revoked key is refused at once");
});

test("a webhook receives signed deliveries for the events it subscribed to, and reports failures", async () => {
  const created = await api("POST", "/integrations/webhooks", { token: state.token, body: { name: "ERP", url: `${receiverUrl}/hook`, events: ["announcement"] } });
  assert.ok([200, 201].includes(created.status), JSON.stringify(created.body));
  const { webhook, secret } = created.body.data;
  assert.match(secret, /^whsec_/);

  const catalog = await api("GET", "/integrations/events", { token: state.token });
  assert.ok(catalog.body.data.some((e) => e.event === "announcement"));

  // A synthetic event, delivered synchronously.
  const tested = await api("POST", `/integrations/webhooks/${webhook.id}/test`, { token: state.token });
  assert.equal(tested.status, 200, JSON.stringify(tested.body));
  assert.equal(tested.body.data.ok, true);
  assert.equal(tested.body.data.responseStatus, 200);
  assert.equal(received.length, 1);
  assert.equal(received[0].headers["x-chefotech-event"], "webhook.test");
  assert.ok(verifySignature(received[0], secret), "the test delivery is signed with the secret shown at creation");
  assert.equal(JSON.parse(received[0].body).event, "webhook.test");

  // A real event: a notification fires, the bus fans out, the queue delivers.
  const organization = await tenant.runAsSystem(() => Organization.findById(state.organizationId).lean(), "test");
  await tenant.runWithTenant(state.organizationId, async () => {
    await notifications.notify({
      template: "announcement",
      recipients: [recipients.userToRecipient(state.owner)],
      organization,
      data: { title: "Town hall", message: "Friday at four." },
      channels: ["in_app"],
    });
  });
  const queued = await waitFor(async () => (await tenant.runAsSystem(() => queue.Job.countDocuments({ name: "webhooks.deliver" }).setOptions({ bypassTenant: true }), "test")) >= 1);
  assert.ok(queued, "the event enqueued a delivery");
  await drainAll();

  const real = received.find((r) => r.headers["x-chefotech-event"] === "announcement");
  assert.ok(real, "the receiver got the announcement");
  assert.ok(verifySignature(real, secret));
  const payload = JSON.parse(real.body);
  assert.equal(payload.organizationId, String(state.organizationId));
  assert.equal(payload.data.title, "Town hall");
  assert.ok(!("actor" in (payload.data || {})) || payload.data.actor === undefined);

  const deliveries = await api("GET", `/integrations/webhooks/${webhook.id}/deliveries`, { token: state.token });
  assert.equal(deliveries.body.data.length, 2);
  assert.ok(deliveries.body.data.every((d) => d.status === "delivered"));

  // An unsubscribed event is not delivered.
  await tenant.runWithTenant(state.organizationId, async () => {
    await notifications.notify({ template: "mfa_changed", recipients: [recipients.userToRecipient(state.owner)], organization, data: { enabled: true }, channels: ["in_app"] });
  });
  await new Promise((resolve) => setTimeout(resolve, 200));
  await drainAll();
  assert.equal(received.filter((r) => r.headers["x-chefotech-event"] === "account.mfa_changed").length, 0);

  // A failing receiver is recorded, not hidden.
  const moved = await api("PATCH", `/integrations/webhooks/${webhook.id}`, { token: state.token, body: { url: `${receiverUrl}/fail` } });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  const failed = await api("POST", `/integrations/webhooks/${webhook.id}/test`, { token: state.token });
  assert.equal(failed.body.data.ok, false);
  assert.equal(failed.body.data.responseStatus, 500);
  const hooks = await api("GET", "/integrations/webhooks", { token: state.token });
  assert.equal(hooks.body.data[0].consecutiveFailures, 1);
  assert.equal(hooks.body.data[0].lastStatus, 500);

  // Rotating the secret changes what deliveries are signed with.
  await api("PATCH", `/integrations/webhooks/${webhook.id}`, { token: state.token, body: { url: `${receiverUrl}/hook` } });
  const rotated = await api("POST", `/integrations/webhooks/${webhook.id}/rotate-secret`, { token: state.token });
  assert.notEqual(rotated.body.data.secret, secret);
  await api("POST", `/integrations/webhooks/${webhook.id}/test`, { token: state.token });
  const latest = received[received.length - 1];
  assert.ok(verifySignature(latest, rotated.body.data.secret));
  assert.ok(!verifySignature(latest, secret));

  // Pausing stops fan-out; deleting removes history.
  await api("PATCH", `/integrations/webhooks/${webhook.id}`, { token: state.token, body: { isActive: false } });
  const before = received.length;
  await tenant.runWithTenant(state.organizationId, async () => {
    await notifications.notify({ template: "announcement", recipients: [recipients.userToRecipient(state.owner)], organization, data: { title: "Again", message: "x" }, channels: ["in_app"] });
  });
  await new Promise((resolve) => setTimeout(resolve, 200));
  await drainAll();
  assert.equal(received.length, before, "a paused webhook hears nothing");

  const removed = await api("DELETE", `/integrations/webhooks/${webhook.id}`, { token: state.token });
  assert.equal(removed.status, 200);
  assert.equal((await api("GET", "/integrations/webhooks", { token: state.token })).body.data.length, 0);
});

test("webhook URLs and event lists are validated", async () => {
  const badUrl = await api("POST", "/integrations/webhooks", { token: state.token, body: { name: "x", url: "not a url", events: ["announcement"] } });
  assert.equal(badUrl.status, 422);
  const noEvents = await api("POST", "/integrations/webhooks", { token: state.token, body: { name: "x", url: `${receiverUrl}/hook`, events: [] } });
  assert.equal(noEvents.status, 422);
});
