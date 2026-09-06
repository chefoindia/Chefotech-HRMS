"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { startDatabase, stopDatabase, clearDatabase } = require("../helpers/db");
const tenant = require("../../src/core/tenancy/tenantContext");
const { createApp } = require("../../src/app");
const User = require("../../src/modules/users/user.model");
const Employee = require("../../src/modules/employees/employee.model");
const Membership = require("../../src/modules/rbac/membership.model");
const Role = require("../../src/modules/rbac/role.model");
const organizationService = require("../../src/modules/organizations/organization.service");
const rbac = require("../../src/modules/rbac/rbac.service");
const settings = require("../../src/core/settings/settings.service");
const dt = require("../../src/shared/datetime");

/**
 * The employee lifecycle over HTTP: onboarding checklists that open
 * themselves for a new joiner, movements (promotion, confirmation) that
 * apply on their date, the directory and duplicate detection, bulk
 * actions, and an exit from resignation to the last day.
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
  rbac.invalidateOrganization("*");

  const owner = await createUser("hr@life.test", "Asha", "Menon");
  const { organization } = await organizationService.provision({ name: "Lifecycle Co", ownerUserId: owner._id });
  state.organizationId = organization._id;

  await tenant.runWithTenant(organization._id, async () => {
    const managerRole = await Role.findOne({ key: "MANAGER" });
    const employeeRole = await Role.findOne({ key: "EMPLOYEE" });
    const managerUser = await createUser("manager@life.test", "Bala", "Iyer");
    state.manager = await Employee.create({ employeeCode: "M001", personal: { firstName: "Bala", lastName: "Iyer", workEmail: "manager@life.test" }, employment: { joiningDate: new Date("2023-01-01") }, status: "active", userId: managerUser._id });
    await Membership.create({ organizationId: organization._id, userId: managerUser._id, employeeId: state.manager._id, roleIds: [managerRole._id], permissions: managerRole.permissions, status: "active", isManager: true });

    const employeeUser = await createUser("ravi@life.test", "Ravi", "Kumar");
    state.employee = await Employee.create({ employeeCode: "E001", personal: { firstName: "Ravi", lastName: "Kumar", workEmail: "ravi@life.test", phone: "9876543210" }, employment: { joiningDate: new Date("2024-02-01"), managerId: state.manager._id, noticePeriodDays: 30 }, status: "active", userId: employeeUser._id });
    await Membership.create({ organizationId: organization._id, userId: employeeUser._id, employeeId: state.employee._id, roleIds: [employeeRole._id], permissions: employeeRole.permissions, status: "active" });
  });

  state.hr = await signIn("hr@life.test");
  state.mgr = await signIn("manager@life.test");
  state.emp = await signIn("ravi@life.test");
});

async function createUser(email, firstName, lastName) {
  const user = new User({ email, firstName, lastName, status: "active", emailVerifiedAt: new Date() });
  await user.setPassword("Password@12345");
  await user.save();
  return user;
}

async function signIn(email) {
  const response = await api("POST", "/auth/login", { body: { email, password: "Password@12345" } });
  assert.equal(response.status, 200, `sign-in failed for ${email}: ${JSON.stringify(response.body)}`);
  return response.body.data.accessToken;
}

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

test("a new joiner gets the onboarding checklist automatically, with tasks owned by the right people", async () => {
  const created = await api("POST", "/employees", { token: state.hr, body: { personal: { firstName: "Priya", lastName: "Shah", workEmail: "priya@life.test" }, employment: { joiningDate: dt.addDays(dt.todayString(), 7), managerId: String(state.manager._id) } } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  await new Promise((r) => setTimeout(r, 200));

  const list = await api("GET", "/onboarding", { token: state.hr });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.data.length, 1, "one checklist opened for the joiner");
  const onboarding = list.body.data[0];
  assert.equal(onboarding.employee.employeeCode, created.body.data.employeeCode);
  assert.ok(onboarding.tasks.length >= 8);
  const managerTask = onboarding.tasks.find((t) => t.owner === "manager");
  assert.equal(managerTask.assignee, "Bala Iyer", "manager tasks go to the reporting manager");
  assert.ok(onboarding.tasks.some((t) => t.dueOn < onboarding.joiningDate), "pre-joining tasks are due before the joining date");

  const mine = await api("GET", "/onboarding/tasks/me", { token: state.mgr });
  assert.ok(mine.body.data.length >= 2, "the manager sees their own tasks across joiners");

  const done = await api("POST", `/onboarding/${onboarding.id}/tasks/${managerTask.id}/complete`, { token: state.mgr, body: { note: "Done on day one" } });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(done.body.data.tasks.find((t) => t.id === managerTask.id).status, "done");
  assert.equal(done.body.data.progress.done, 1);

  const notMine = await api("POST", `/onboarding/${onboarding.id}/tasks/${onboarding.tasks.find((t) => t.owner === "it").id}/complete`, { token: state.emp, body: {} });
  assert.equal(notMine.status, 403, "someone else's task cannot be ticked by an employee");

  // Auto-completion: a portal invitation ticks its task.
  const invited = await api("POST", `/employees/${created.body.data.id}/invite`, { token: state.hr, body: {} });
  assert.ok([200, 201].includes(invited.status), JSON.stringify(invited.body));
  const auto = await api("POST", "/onboarding/run-auto", { token: state.hr });
  const afterAuto = await api("GET", `/onboarding/${onboarding.id}`, { token: state.hr });
  assert.ok(auto.body.data.completed >= 1, `the portal-invited task completed itself: ${JSON.stringify(auto.body)} ${JSON.stringify(afterAuto.body.data.tasks.map((t) => [t.title, t.autoComplete, t.status]))} portal=${afterAuto.body.data.employee.hasPortalAccount}`);

  await tenant.runWithTenant(state.organizationId, () => settings.set("onboarding.auto_start", false));
  const quiet = await api("POST", "/employees", { token: state.hr, body: { personal: { firstName: "Quiet", lastName: "Joiner" }, employment: { joiningDate: dt.todayString() } } });
  await new Promise((r) => setTimeout(r, 200));
  const after = await api("GET", "/onboarding", { token: state.hr });
  assert.equal(after.body.data.length, 1, "with auto-start off, nothing opens");
  void quiet;
});

test("a promotion dated today applies at once; one dated later waits; confirmation fills the date", async () => {
  await tenant.runWithTenant(state.organizationId, async () => {
    const Designation = require("../../src/modules/designations/designation.model");
    state.senior = await Designation.create({ name: "Senior Engineer", code: "SE" });
  });

  const now = await api("POST", `/employees/${state.employee._id}/changes`, { token: state.hr, body: { type: "promotion", effectiveDate: dt.todayString(), changes: { designationId: String(state.senior._id) }, reason: "Annual review", generateLetter: false } });
  assert.equal(now.status, 201, JSON.stringify(now.body));
  assert.equal(now.body.data.status, "applied");
  const employee = await api("GET", `/employees/${state.employee._id}`, { token: state.hr });
  assert.equal(String(employee.body.data.employment.designationId.id || employee.body.data.employment.designationId._id || employee.body.data.employment.designationId), String(state.senior._id));

  const later = await api("POST", `/employees/${state.employee._id}/changes`, { token: state.hr, body: { type: "manager", effectiveDate: dt.addDays(dt.todayString(), 10), changes: { managerId: null }, generateLetter: false } });
  assert.equal(later.body.data.status, "scheduled");
  const history = await api("GET", `/employees/${state.employee._id}/changes`, { token: state.hr });
  assert.equal(history.body.data.length, 2);
  const cancelled = await api("POST", `/employees/${state.employee._id}/changes/${later.body.data.id}/cancel`, { token: state.hr });
  assert.equal(cancelled.body.data.status, "cancelled");

  const due = await api("GET", "/employees/probation-due?days=3650", { token: state.hr });
  assert.ok(due.body.data.some((e) => e.employeeCode === "E001"), "an unconfirmed employee shows in the probation list");
  const confirmed = await api("POST", `/employees/${state.employee._id}/changes`, { token: state.hr, body: { type: "confirmation", effectiveDate: dt.todayString(), generateLetter: false } });
  assert.equal(confirmed.status, 201, JSON.stringify(confirmed.body));
  assert.equal(confirmed.body.data.status, "applied");
  const afterConfirm = await api("GET", "/employees/probation-due?days=3650", { token: state.hr });
  assert.ok(!afterConfirm.body.data.some((e) => e.employeeCode === "E001"));
});

test("the directory is open to every employee and shows nothing sensitive; duplicates and bulk actions work for HR", async () => {
  const dir = await api("GET", "/employees/directory?q=ravi", { token: state.emp });
  assert.equal(dir.status, 200, JSON.stringify(dir.body));
  assert.equal(dir.body.data.length, 1);
  assert.equal(dir.body.data[0].name, "Ravi Kumar");
  assert.equal(dir.body.data[0].manager.name, "Bala Iyer");
  assert.equal(JSON.stringify(dir.body.data[0]).includes("bank"), false);

  await tenant.runWithTenant(state.organizationId, () => Employee.create({ employeeCode: "E002", personal: { firstName: "Ravi", lastName: "K", phone: "9876543210" }, status: "active" }));
  const dupes = await api("GET", "/employees/duplicates", { token: state.hr });
  assert.equal(dupes.status, 200);
  assert.ok(dupes.body.data.some((g) => g.kind === "phone" && g.employees.length === 2));

  const employees = await api("GET", "/employees", { token: state.hr });
  const ids = employees.body.data.map((e) => e.id);
  const bulk = await api("POST", "/employees/bulk", { token: state.hr, body: { employeeIds: ids, action: "add_tag", value: "2026-batch" } });
  assert.equal(bulk.status, 200, JSON.stringify(bulk.body));
  assert.equal(bulk.body.data.updated, ids.length);
  const tagged = await api("GET", `/employees/${state.employee._id}`, { token: state.hr });
  assert.ok(tagged.body.data.tags.includes("2026-batch"));

  const forbidden = await api("POST", "/employees/bulk", { token: state.emp, body: { employeeIds: ids, action: "add_tag", value: "x" } });
  assert.equal(forbidden.status, 403);
});

test("a resignation runs from request to last day: accepted, cleared, settled, completed", async () => {
  const resigned = await api("POST", "/exits/resign", { token: state.emp, body: { proposedLastDay: dt.addDays(dt.todayString(), 20), reason: "Moving city" } });
  assert.equal(resigned.status, 201, JSON.stringify(resigned.body));
  assert.equal(resigned.body.data.status, "requested");
  assert.equal(resigned.body.data.noticeShortfallDays, 10, "20 days offered against a 30-day notice");

  const twice = await api("POST", "/exits/resign", { token: state.emp, body: {} });
  assert.equal(twice.status, 409);

  const mine = await api("GET", "/exits/me", { token: state.emp });
  assert.equal(mine.body.data.id, resigned.body.data.id);

  const accepted = await api("POST", `/exits/${resigned.body.data.id}/decide`, { token: state.hr, body: { decision: "approve", noticeWaived: true, comment: "All the best" } });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.data.status, "in_progress");
  assert.equal(accepted.body.data.noticeShortfallDays, 0, "waiving the notice clears the shortfall");
  assert.ok(accepted.body.data.tasks.length >= 7);
  const handover = accepted.body.data.tasks.find((t) => t.owner === "manager");
  assert.equal(handover.assignee, "Bala Iyer");

  const employee = await api("GET", `/employees/${state.employee._id}`, { token: state.hr });
  assert.equal(employee.body.data.status, "notice_period");

  const tooSoon = await api("POST", `/exits/${resigned.body.data.id}/complete`, { token: state.hr });
  assert.equal(tooSoon.status, 409, "clearance must finish first");

  const managerTasks = await api("GET", "/exits/tasks/me", { token: state.mgr });
  assert.equal(managerTasks.body.data.length, 1);
  for (const task of accepted.body.data.tasks) {
    const token = task.owner === "manager" ? state.mgr : state.hr;
    const done = await api("POST", `/exits/${resigned.body.data.id}/tasks/${task.id}/complete`, { token, body: task.owner === "it" ? { recoveryAmount: 1500, note: "Charger missing" } : {} });
    assert.equal(done.status, 200, JSON.stringify(done.body));
  }

  const computed = await api("POST", `/exits/${resigned.body.data.id}/settlement/compute`, { token: state.hr });
  assert.equal(computed.status, 200, JSON.stringify(computed.body));
  assert.ok(computed.body.data.settlement.recoveries.some((r) => r.amount === 1500), "clearance recoveries land in the settlement");

  const settled = await api("POST", `/exits/${resigned.body.data.id}/settlement/settle`, { token: state.hr, body: { generateDocument: false } });
  assert.equal(settled.status, 200, JSON.stringify(settled.body));
  assert.ok(settled.body.data.settlement.settledAt);

  const completed = await api("POST", `/exits/${resigned.body.data.id}/complete`, { token: state.hr, body: { generateLetters: false } });
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  assert.equal(completed.body.data.status, "completed");
  const gone = await api("GET", `/employees/${state.employee._id}`, { token: state.hr });
  assert.equal(gone.body.data.status, "resigned");

  const blocked = await api("GET", "/auth/me", { token: state.emp });
  assert.ok([401, 403].includes(blocked.status), "a leaver's portal access ends");
  assert.equal(blocked.body.error.code, "ACCOUNT_DISABLED");
});
