"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { startDatabase, stopDatabase, clearDatabase } = require("../helpers/db");
const { createApp } = require("../../src/app");
const User = require("../../src/modules/users/user.model");
const organizationService = require("../../src/modules/organizations/organization.service");
const tenant = require("../../src/core/tenancy/tenantContext");
const Employee = require("../../src/modules/employees/employee.model");
const Membership = require("../../src/modules/rbac/membership.model");
const Role = require("../../src/modules/rbac/role.model");
const rbac = require("../../src/modules/rbac/rbac.service");
const mailer = require("../../src/modules/notifications/mailer");
const schedules = require("../../src/modules/documents/sheetSchedule.service");
const dt = require("../../src/shared/datetime");

/**
 * Sheets that email themselves, and the organization data export.
 *
 * Both ride on the same new capability — an email with a stored file
 * attached — so the contract under test is: a run renders the sheet, stores
 * the file, and the message that reaches the mail transport carries the
 * bytes; an export produces a real zip the requester can download, and
 * nobody else can.
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

  const owner = new User({ email: "hr@sched.test", firstName: "Dev", lastName: "Iyer", status: "active", emailVerifiedAt: new Date() });
  await owner.setPassword("Password@12345");
  await owner.save();
  rbac.invalidateOrganization("*");
  const { organization } = await organizationService.provision({ name: "Schedule Testing Co", ownerUserId: owner._id });
  state.organizationId = organization._id;

  const login = await api("POST", "/auth/login", { body: { email: "hr@sched.test", password: "Password@12345" } });
  state.token = login.body.data.accessToken;

  for (const [first, last] of [["Anu", "K"], ["Bala", "S"], ["Chitra", "V"]]) {
    const created = await api("POST", "/employees", {
      token: state.token,
      body: { personal: { firstName: first, lastName: last, workEmail: `${first.toLowerCase()}@sched.test` }, employment: { joiningDate: "2025-01-15" } },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
  }
  const seeded = await api("POST", "/sheets/seed-defaults", { token: state.token });
  assert.equal(seeded.status, 200);
  const sheets = (await api("GET", "/sheets", { token: state.token })).body.data;
  state.employeeSheet = sheets.find((s) => s.source === "employees");
  assert.ok(state.employeeSheet, "an employees sheet is seeded");
});

async function api(method, path, { token, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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

test("a scheduled sheet renders, stores the file and emails it as an attachment", async () => {
  const created = await api("POST", "/sheets/schedules", {
    token: state.token,
    body: {
      sheetId: state.employeeSheet.id,
      name: "Headcount every Monday",
      frequency: "weekly",
      dayOfWeek: 1,
      hour: 8,
      period: "none",
      format: "csv",
      recipients: ["accounts@sched.test", "plant.head@sched.test"],
      message: "Attached is the weekly headcount.",
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.data.sheet.name, state.employeeSheet.name);

  const listed = await api("GET", `/sheets/schedules?sheetId=${state.employeeSheet.id}`, { token: state.token });
  assert.equal(listed.body.data.length, 1);

  const outboxBefore = mailer.devOutbox().length;
  const ran = await api("POST", `/sheets/schedules/${created.body.data.id}/run`, { token: state.token });
  assert.equal(ran.status, 200, JSON.stringify(ran.body));
  assert.equal(ran.body.data.rows, 3);
  assert.equal(ran.body.data.recipients, 2);

  const sent = mailer.devOutbox().slice(0, mailer.devOutbox().length - outboxBefore);
  const toAccounts = sent.find((m) => String(m.to).includes("accounts@sched.test"));
  assert.ok(toAccounts, "the accounts recipient got an email");
  assert.equal(toAccounts.attachments.length, 1);
  assert.match(toAccounts.attachments[0].filename, /\.csv$/);
  const csv = toAccounts.attachments[0].content.toString("utf8");
  assert.ok(csv.includes("Anu"), "the attachment holds the rendered rows");
  assert.ok(toAccounts.text.includes("Attached is the weekly headcount."));

  const after = (await api("GET", "/sheets/schedules", { token: state.token })).body.data[0];
  assert.equal(after.lastRunStatus, "ok");
  assert.ok(after.lastFileId);

  // The stored file is readable by someone who may export sheets.
  const download = await fetch(`${baseUrl}/files/${after.lastFileId}/content`, { headers: { Authorization: `Bearer ${state.token}` } });
  assert.equal(download.status, 200);

  // Pausing stops the hourly sweep from firing it.
  const paused = await api("PATCH", `/sheets/schedules/${after.id}`, { token: state.token, body: { isActive: false } });
  assert.equal(paused.body.data.isActive, false);
});

test("a schedule fires once in its hour, on its day, and never twice for the same hour", () => {
  const monday8 = dt.nowIn("Asia/Kolkata").day(1).hour(8).minute(5);
  const base = { isActive: true, hour: 8, frequency: "weekly", dayOfWeek: 1, dayOfMonth: 1, lastFiredKey: null };

  assert.equal(schedules.isDue(base, monday8), true);
  assert.equal(schedules.isDue({ ...base, hour: 9 }, monday8), false, "wrong hour");
  assert.equal(schedules.isDue({ ...base, dayOfWeek: 2 }, monday8), false, "wrong weekday");
  assert.equal(schedules.isDue({ ...base, isActive: false }, monday8), false, "paused");
  assert.equal(schedules.isDue({ ...base, lastFiredKey: monday8.format("YYYY-MM-DD-HH") }, monday8), false, "already fired this hour");
  assert.equal(schedules.isDue({ ...base, frequency: "daily" }, monday8.day(3)), true, "daily ignores the weekday");
  assert.equal(schedules.isDue({ ...base, frequency: "monthly", dayOfMonth: monday8.date() }, monday8), true);
  assert.equal(schedules.isDue({ ...base, frequency: "monthly", dayOfMonth: monday8.date() === 28 ? 1 : 28 }, monday8), false);
});

test("relative periods resolve to concrete filters", async () => {
  const lastMonth = await schedules.resolvePeriod("last_month", "Asia/Kolkata");
  assert.match(lastMonth.fromDate, /-01$/);
  assert.ok(lastMonth.toDate > lastMonth.fromDate);
  const yesterday = await schedules.resolvePeriod("yesterday", "Asia/Kolkata");
  assert.equal(yesterday.fromDate, yesterday.toDate);
  const lastWeek = await schedules.resolvePeriod("last_week", "Asia/Kolkata");
  assert.equal(dt.weekdayIndex(lastWeek.fromDate), 1, "weeks start on Monday");
  assert.equal(dt.weekdayIndex(lastWeek.toDate), 0);
  assert.deepEqual(await schedules.resolvePeriod("none", "Asia/Kolkata"), {});
});

test("a schedule needs at least one valid recipient and a real sheet", async () => {
  const noRecipients = await api("POST", "/sheets/schedules", {
    token: state.token,
    body: { sheetId: state.employeeSheet.id, name: "x", frequency: "daily", recipients: [] },
  });
  assert.equal(noRecipients.status, 422);
  const badEmail = await api("POST", "/sheets/schedules", {
    token: state.token,
    body: { sheetId: state.employeeSheet.id, name: "x", frequency: "daily", recipients: ["not-an-email"] },
  });
  assert.equal(badEmail.status, 422);
  const missingSheet = await api("POST", "/sheets/schedules", {
    token: state.token,
    body: { sheetId: "64b000000000000000000000", name: "x", frequency: "daily", recipients: ["a@b.co"] },
  });
  assert.equal(missingSheet.status, 404);
});

test("an organization export produces a downloadable zip and is rate limited", async () => {
  const requested = await api("POST", "/organizations/current/exports", { token: state.token });
  assert.equal(requested.status, 200, JSON.stringify(requested.body));

  // Jobs are off under test, so the request drained the queue inline.
  const listed = await api("GET", "/organizations/current/exports", { token: state.token });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.data.length, 1);
  const file = listed.body.data[0];
  assert.match(file.fileName, /-export-\d{4}-\d{2}-\d{2}\.zip$/);
  assert.equal(file.collections.employees, 3);
  assert.equal(file.collections.sheet_templates > 0, true);

  const download = await fetch(`${baseUrl}/files/${file.id}/content`, { headers: { Authorization: `Bearer ${state.token}` } });
  assert.equal(download.status, 200);
  const bytes = Buffer.from(await download.arrayBuffer());
  assert.equal(bytes.subarray(0, 2).toString("latin1"), "PK", "a zip file");
  assert.ok(bytes.length > 500);

  const again = await api("POST", "/organizations/current/exports", { token: state.token });
  assert.equal(again.status, 409);

  // An employee cannot ask for, list, or read the export.
  await tenant.runWithTenant(state.organizationId, async () => {
    const employeeRole = await Role.findOne({ key: "EMPLOYEE" });
    const user = new User({ email: "emp@sched.test", firstName: "Ravi", lastName: "Kumar", status: "active", emailVerifiedAt: new Date() });
    await user.setPassword("Password@12345");
    await user.save();
    const employee = await Employee.create({ employeeCode: "E900", personal: { firstName: "Ravi", lastName: "Kumar", workEmail: "emp@sched.test" }, employment: { joiningDate: new Date("2024-02-01") }, status: "active", userId: user._id });
    await Membership.create({ organizationId: state.organizationId, userId: user._id, employeeId: employee._id, roleIds: [employeeRole._id], permissions: employeeRole.permissions, status: "active" });
  });
  const login = await api("POST", "/auth/login", { body: { email: "emp@sched.test", password: "Password@12345" } });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  const forbidden = await api("POST", "/organizations/current/exports", { token: login.body.data.accessToken });
  assert.equal(forbidden.status, 403);
  const listing = await api("GET", "/organizations/current/exports", { token: login.body.data.accessToken });
  assert.equal(listing.status, 403);
  const hidden = await fetch(`${baseUrl}/files/${file.id}/content`, { headers: { Authorization: `Bearer ${login.body.data.accessToken}` } });
  assert.equal(hidden.status, 404);
});
