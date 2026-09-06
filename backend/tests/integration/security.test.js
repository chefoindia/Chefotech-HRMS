"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { startDatabase, stopDatabase, clearDatabase } = require("../helpers/db");
const { createApp } = require("../../src/app");
const User = require("../../src/modules/users/user.model");
const Setting = require("../../src/core/settings/setting.model");
const organizationService = require("../../src/modules/organizations/organization.service");
const settings = require("../../src/core/settings/settings.service");
const tenant = require("../../src/core/tenancy/tenantContext");
const totp = require("../../src/core/security/totp");

/**
 * Account security over real HTTP: two-factor enrolment and challenge,
 * recovery codes, the organization's password rules, idle timeout, the IP
 * allowlist (including the guard that stops an admin locking themselves
 * out), and session listing and revocation.
 */

let server;
let baseUrl;
const state = {};

test.before(async () => {
  await startDatabase();
  const app = createApp();
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/v1`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await stopDatabase();
});

test.beforeEach(async () => {
  await clearDatabase();
  settings.invalidateAll && settings.invalidateAll();

  const owner = new User({ email: "owner@secure.test", firstName: "Asha", lastName: "Menon", status: "active", emailVerifiedAt: new Date() });
  await owner.setPassword("Password@12345");
  await owner.save();
  const { organization } = await organizationService.provision({ name: "Secure Co", ownerUserId: owner._id });
  state.organizationId = organization._id;
  state.ownerId = owner._id;

  const login = await api("POST", "/auth/login", { body: { email: "owner@secure.test", password: "Password@12345" } });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  state.token = login.body.data.accessToken;
  state.refreshToken = login.body.data.refreshToken;
});

async function api(method, path, { token, body, headers } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(headers || {}) },
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

async function enrolMfa() {
  const setup = await api("POST", "/auth/mfa/setup", { token: state.token });
  assert.equal(setup.status, 200, JSON.stringify(setup.body));
  const secret = setup.body.data.secret;
  assert.ok(setup.body.data.otpauthUrl.includes(`secret=${secret}`));
  assert.ok(String(setup.body.data.qrDataUrl || "").startsWith("data:image/png"), "a QR is returned for the app to scan");

  const wrong = await api("POST", "/auth/mfa/enable", { token: state.token, body: { token: "000000" } });
  assert.equal(wrong.status, 401, "a wrong code does not switch it on");

  const enabled = await api("POST", "/auth/mfa/enable", { token: state.token, body: { token: totp.generateToken(secret) } });
  assert.equal(enabled.status, 200, JSON.stringify(enabled.body));
  assert.equal(enabled.body.data.enabled, true);
  assert.equal(enabled.body.data.recoveryCodes.length, 10);
  return { secret, recoveryCodes: enabled.body.data.recoveryCodes };
}

test("two-factor: enrol, then sign in needs the code; the same code cannot be replayed", async () => {
  const { secret } = await enrolMfa();

  const first = await api("POST", "/auth/login", { body: { email: "owner@secure.test", password: "Password@12345" } });
  assert.equal(first.status, 200);
  assert.equal(first.body.data.mode, "mfa_required");
  assert.equal(first.body.data.accessToken, undefined, "no session before the second factor");
  const mfaToken = first.body.data.mfaToken;

  const bad = await api("POST", "/auth/mfa/verify", { body: { mfaToken, token: "123456" } });
  assert.equal(bad.status, 401);

  // A fresh step so the enrolment code's counter is not the one presented.
  await new Promise((r) => setTimeout(r, 10));
  const code = totp.generateToken(secret, Date.now() + 30_000);
  const good = await api("POST", "/auth/mfa/verify", { body: { mfaToken, token: code } });
  assert.equal(good.status, 200, JSON.stringify(good.body));
  assert.equal(good.body.data.mode, "session");
  assert.equal(typeof good.body.data.accessToken, "string");
  assert.equal(good.body.data.mfaEnabled, true);

  const replay = await api("POST", "/auth/mfa/verify", { body: { mfaToken, token: code } });
  assert.equal(replay.status, 401, "the same code is refused a second time");

  const status = await api("GET", "/auth/security", { token: good.body.data.accessToken });
  assert.equal(status.body.data.mfaEnabled, true);
  assert.equal(status.body.data.recoveryCodesRemaining, 10);
});

test("two-factor: a recovery code works exactly once, and disabling needs password plus code", async () => {
  const { secret, recoveryCodes } = await enrolMfa();

  const challenge = await api("POST", "/auth/login", { body: { email: "owner@secure.test", password: "Password@12345" } });
  const viaRecovery = await api("POST", "/auth/mfa/verify", { body: { mfaToken: challenge.body.data.mfaToken, token: recoveryCodes[0] } });
  assert.equal(viaRecovery.status, 200, JSON.stringify(viaRecovery.body));

  const again = await api("POST", "/auth/login", { body: { email: "owner@secure.test", password: "Password@12345" } });
  const reused = await api("POST", "/auth/mfa/verify", { body: { mfaToken: again.body.data.mfaToken, token: recoveryCodes[0] } });
  assert.equal(reused.status, 401, "a used recovery code is dead");

  const status = await api("GET", "/auth/security", { token: viaRecovery.body.data.accessToken });
  assert.equal(status.body.data.recoveryCodesRemaining, 9);

  // The enrolment consumed this time step's code and the drift window is one
  // step either side, so within the same half-minute a second recovery code
  // is the honest way to present another factor.
  const noPassword = await api("POST", "/auth/mfa/disable", { token: viaRecovery.body.data.accessToken, body: { password: "wrong", token: recoveryCodes[1] } });
  assert.equal(noPassword.status, 401);

  const staleCode = await api("POST", "/auth/mfa/disable", { token: viaRecovery.body.data.accessToken, body: { password: "Password@12345", token: totp.generateToken(secret) } });
  assert.equal(staleCode.status, 401, "the code used to enrol cannot be presented again");

  const disabled = await api("POST", "/auth/mfa/disable", { token: viaRecovery.body.data.accessToken, body: { password: "Password@12345", token: recoveryCodes[1] } });
  assert.equal(disabled.status, 200, JSON.stringify(disabled.body));
  assert.equal(disabled.body.data.enabled, false);
  void secret;

  const plain = await api("POST", "/auth/login", { body: { email: "owner@secure.test", password: "Password@12345" } });
  assert.equal(plain.body.data.mode, "session", "with two-factor off, sign-in is one step again");
});

test("an organization that enforces two-factor for admins flags the owner until they enrol", async () => {
  await tenant.runWithTenant(state.organizationId, () => settings.set("security.enforce_two_factor", true));

  const login = await api("POST", "/auth/login", { body: { email: "owner@secure.test", password: "Password@12345" } });
  assert.equal(login.body.data.mfaSetupRequired, true);
  assert.equal(login.body.data.redirectTo, "/me/security?setup=1");

  const me = await api("GET", "/auth/me", { token: login.body.data.accessToken });
  assert.equal(me.body.data.mfaSetupRequired, true);

  state.token = login.body.data.accessToken;
  const { secret, recoveryCodes } = await enrolMfa();

  const challenge = await api("POST", "/auth/login", { body: { email: "owner@secure.test", password: "Password@12345" } });
  const session = await api("POST", "/auth/mfa/verify", { body: { mfaToken: challenge.body.data.mfaToken, token: totp.generateToken(secret, Date.now() + 30_000) } });
  assert.equal(session.status, 200, JSON.stringify(session.body));
  assert.equal(session.body.data.mfaSetupRequired, false);

  const cannotDisable = await api("POST", "/auth/mfa/disable", { token: session.body.data.accessToken, body: { password: "Password@12345", token: recoveryCodes[0] } });
  assert.equal(cannotDisable.status, 403, "an admin cannot switch off what the organization requires");
});

test("the organization's minimum password length is enforced on change", async () => {
  await tenant.runWithTenant(state.organizationId, () => settings.set("security.password_min_length", 16));

  const short = await api("POST", "/auth/change-password", { token: state.token, body: { currentPassword: "Password@12345", newPassword: "Shorter@1234" } });
  assert.equal(short.status, 422, JSON.stringify(short.body));
  assert.match(JSON.stringify(short.body), /16 characters/);

  const fine = await api("POST", "/auth/change-password", { token: state.token, body: { currentPassword: "Password@12345", newPassword: "MuchLongerPassword@12345" } });
  assert.equal(fine.status, 200, JSON.stringify(fine.body));
});

test("an expired password is flagged at sign-in and routes to the security screen", async () => {
  await tenant.runWithTenant(state.organizationId, () => settings.set("security.password_expiry_days", 30));
  await User.updateOne({ _id: state.ownerId }, { $set: { passwordChangedAt: new Date(Date.now() - 45 * 86400000) } });

  const login = await api("POST", "/auth/login", { body: { email: "owner@secure.test", password: "Password@12345" } });
  assert.equal(login.body.data.passwordExpired, true);
  assert.equal(login.body.data.redirectTo, "/me/security?expired=1");
});

test("a session idle for longer than the organization allows cannot be refreshed", async () => {
  await tenant.runWithTenant(state.organizationId, () => settings.set("security.session_idle_minutes", 15));

  // Age the refresh token by twenty minutes.
  const user = await User.findById(state.ownerId).select("+refreshTokens");
  for (const entry of user.refreshTokens) entry.createdAt = new Date(Date.now() - 20 * 60000);
  await user.save();

  const refreshed = await api("POST", "/auth/refresh", { body: { refreshToken: state.refreshToken } });
  assert.equal(refreshed.status, 401, JSON.stringify(refreshed.body));
  assert.equal(refreshed.body.error.code, "SESSION_IDLE");
});

test("the IP allowlist refuses other networks, and refuses to be saved in a way that locks its author out", async () => {
  // Saving a list that excludes the caller's own address is refused.
  const lockout = await api("PATCH", "/settings", { token: state.token, body: { "security.allowed_ip_ranges": ["203.0.113.0/24"] } });
  assert.equal(lockout.status, 422, JSON.stringify(lockout.body));
  assert.match(JSON.stringify(lockout.body), /lock you out/);

  const malformed = await api("PATCH", "/settings", { token: state.token, body: { "security.allowed_ip_ranges": ["127.0.0.1", "not-an-ip"] } });
  assert.equal(malformed.status, 422);

  // Including the caller's address is accepted.
  const fine = await api("PATCH", "/settings", { token: state.token, body: { "security.allowed_ip_ranges": ["127.0.0.0/8", "::1"] } });
  assert.equal(fine.status, 200, JSON.stringify(fine.body));

  // Now force a list that excludes the test client, straight into the store.
  await tenant.runWithTenant(state.organizationId, () =>
    Setting.updateOne({ key: "security.allowed_ip_ranges" }, { $set: { value: ["203.0.113.0/24"] } })
  );
  settings.invalidate(state.organizationId);

  const blockedRequest = await api("GET", "/auth/me", { token: state.token });
  assert.equal(blockedRequest.status, 403, JSON.stringify(blockedRequest.body));
  assert.equal(blockedRequest.body.error.code, "IP_NOT_ALLOWED");

  const blockedLogin = await api("POST", "/auth/login", { body: { email: "owner@secure.test", password: "Password@12345" } });
  assert.equal(blockedLogin.status, 403);
  assert.equal(blockedLogin.body.error.code, "IP_NOT_ALLOWED");
});

test("sessions can be listed and revoked, one at a time or all others at once", async () => {
  const second = await api("POST", "/auth/login", { body: { email: "owner@secure.test", password: "Password@12345" }, headers: { "user-agent": "Mozilla/5.0 (iPhone) Safari" } });
  assert.equal(second.status, 200);

  const list = await api("GET", "/auth/sessions", { token: state.token, headers: { "x-refresh-token": state.refreshToken } });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.data.length, 2);
  const phone = list.body.data.find((s) => /iPhone/.test(s.userAgent || ""));
  assert.ok(phone, "the second sign-in appears as its own session");
  assert.ok(list.body.data.some((s) => s.current), "the session making the request is marked as current");
  assert.equal(phone.current, false);

  const revoked = await api("DELETE", `/auth/sessions/${phone.id}`, { token: state.token });
  assert.equal(revoked.status, 200);
  assert.equal(revoked.body.data.revoked, 1);

  const phoneRefresh = await api("POST", "/auth/refresh", { body: { refreshToken: second.body.data.refreshToken } });
  assert.equal(phoneRefresh.status, 401, "the revoked session cannot refresh");

  await api("POST", "/auth/login", { body: { email: "owner@secure.test", password: "Password@12345" }, headers: { "user-agent": "Mozilla/5.0 (Linux; Android) Chrome" } });
  const others = await api("POST", "/auth/sessions/revoke-others", { token: state.token, body: { refreshToken: state.refreshToken } });
  assert.equal(others.status, 200);
  assert.ok(others.body.data.revoked >= 1);

  const mine = await api("POST", "/auth/refresh", { body: { refreshToken: state.refreshToken } });
  assert.equal(mine.status, 200, "the current session survives revoke-others");
});
