"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { startDatabase, stopDatabase, clearDatabase } = require("../helpers/db");
const tenant = require("../../src/core/tenancy/tenantContext");

const { createApp } = require("../../src/app");
const User = require("../../src/modules/users/user.model");
const Organization = require("../../src/modules/organizations/organization.model");
const Employee = require("../../src/modules/employees/employee.model");
const Department = require("../../src/modules/departments/department.model");
const Membership = require("../../src/modules/rbac/membership.model");
const Role = require("../../src/modules/rbac/role.model");
const organizationService = require("../../src/modules/organizations/organization.service");
const rbac = require("../../src/modules/rbac/rbac.service");

/**
 * Authorization, over real HTTP.
 *
 * The engine tests prove the maths; these prove the perimeter. Every case here
 * is one an attacker or a curious employee would actually try: reusing a token
 * against another organization, asking for a colleague's salary, hitting an
 * admin endpoint from an employee account.
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

  // ── Organization A, with an HR admin and an ordinary employee ────────────
  const ownerA = await createUser("hr@alpha.test", "Asha", "Menon");
  const { organization: orgA } = await organizationService.provision({
    name: "Alpha Textiles",
    ownerUserId: ownerA._id,
  });

  // ── Organization B, entirely separate ────────────────────────────────────
  const ownerB = await createUser("hr@beta.test", "Bala", "Iyer");
  const { organization: orgB } = await organizationService.provision({
    name: "Beta Foods",
    ownerUserId: ownerB._id,
  });

  state.orgA = orgA;
  state.orgB = orgB;

  await tenant.runWithTenant(orgA._id, async () => {
    state.departmentA = await Department.create({ name: "Alpha Ops", code: "OPS" });

    state.employeeA = await Employee.create({
      employeeCode: "A0001",
      personal: { firstName: "Ravi", lastName: "Kumar", workEmail: "ravi@alpha.test" },
      bank: { accountNumber: "1234567890", bankName: "SBI" },
      employment: { departmentId: state.departmentA._id },
      status: "active",
    });

    state.colleagueA = await Employee.create({
      employeeCode: "A0002",
      personal: { firstName: "Meera", lastName: "Nair", workEmail: "meera@alpha.test" },
      bank: { accountNumber: "9999888877", bankName: "HDFC" },
      status: "active",
    });

    // Give Ravi a login with the default (employee) role.
    const employeeRole = await Role.findOne({ key: "EMPLOYEE" });
    const ravi = await createUser("ravi@alpha.test", "Ravi", "Kumar");
    await Membership.create({
      organizationId: orgA._id,
      userId: ravi._id,
      employeeId: state.employeeA._id,
      roleIds: [employeeRole._id],
      permissions: employeeRole.permissions,
      status: "active",
    });
    await Employee.updateOne({ _id: state.employeeA._id }, { $set: { userId: ravi._id } });
    state.raviUser = ravi;
  });

  await tenant.runWithTenant(orgB._id, async () => {
    state.departmentB = await Department.create({ name: "Beta Kitchen", code: "KITCHEN" });
  });

  state.tokenHrA = await signIn("hr@alpha.test");
  state.tokenHrB = await signIn("hr@beta.test");
  state.tokenEmployeeA = await signIn("ravi@alpha.test");
});

async function createUser(email, firstName, lastName) {
  const user = new User({ email, firstName, lastName, status: "active", emailVerifiedAt: new Date() });
  await user.setPassword("Password@12345");
  await user.save();
  return user;
}

async function signIn(email) {
  const response = await api("POST", "/auth/login", {
    body: { email, password: "Password@12345" },
  });
  assert.equal(response.status, 200, `sign-in failed for ${email}: ${JSON.stringify(response.body)}`);
  return response.body.data.accessToken;
}

async function api(method, path, { token, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

// ── Authentication ──────────────────────────────────────────────────────────

test("an unauthenticated request is refused", async () => {
  const response = await api("GET", "/employees");
  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, "UNAUTHENTICATED");
});

test("a malformed token is refused", async () => {
  const response = await api("GET", "/employees", { token: "not-a-real-token" });
  assert.equal(response.status, 401);
});

test("sign-in returns a session scoped to the user's organization", async () => {
  const response = await api("POST", "/auth/login", {
    body: { email: "hr@alpha.test", password: "Password@12345" },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.mode, "session");
  assert.equal(response.body.data.organization.name, "Alpha Textiles");
  assert.ok(response.body.data.accessToken);
  assert.ok(response.body.data.permissions.includes("employee.view"));
});

test("a wrong password is rejected without revealing whether the account exists", async () => {
  const wrongPassword = await api("POST", "/auth/login", {
    body: { email: "hr@alpha.test", password: "Wrong@12345678" },
  });
  const unknownUser = await api("POST", "/auth/login", {
    body: { email: "nobody@nowhere.test", password: "Wrong@12345678" },
  });

  assert.equal(wrongPassword.status, 401);
  assert.equal(unknownUser.status, 401);
  assert.equal(wrongPassword.body.error.code, unknownUser.body.error.code);
  assert.equal(wrongPassword.body.error.message, unknownUser.body.error.message);
});

// ── Cross-tenant access ─────────────────────────────────────────────────────

test("a tenant's list contains only its own records", async () => {
  const alpha = await api("GET", "/departments", { token: state.tokenHrA });
  const beta = await api("GET", "/departments", { token: state.tokenHrB });

  assert.equal(alpha.status, 200);
  assert.deepEqual(alpha.body.data.map((d) => d.code), ["OPS"]);
  assert.deepEqual(beta.body.data.map((d) => d.code), ["KITCHEN"]);
});

test("Tenant A cannot read Tenant B's record, even with its exact id", async () => {
  const response = await api("GET", `/departments/${state.departmentB._id}`, {
    token: state.tokenHrA,
  });

  assert.equal(response.status, 404, "reported as missing, never as forbidden");
  assert.equal(response.body.error.code, "NOT_FOUND");
});

test("Tenant A cannot read Tenant B's employees", async () => {
  const bEmployee = await tenant.runWithTenant(state.orgB._id, () =>
    Employee.create({
      employeeCode: "B0001",
      personal: { firstName: "Sita", lastName: "Rao" },
      status: "active",
    })
  );

  const response = await api("GET", `/employees/${bEmployee._id}`, { token: state.tokenHrA });
  assert.equal(response.status, 404);
});

test("Tenant A cannot modify Tenant B's record", async () => {
  const response = await api("PATCH", `/departments/${state.departmentB._id}`, {
    token: state.tokenHrA,
    body: { name: "Hijacked" },
  });

  assert.equal(response.status, 404);

  const untouched = await tenant.runWithTenant(state.orgB._id, () =>
    Department.findById(state.departmentB._id).lean()
  );
  assert.equal(untouched.name, "Beta Kitchen");
});

test("a token from one organization cannot be pointed at another", async () => {
  // Switching organizations requires a membership; Alpha's admin has none in Beta.
  const response = await api("POST", "/auth/switch-organization", {
    token: state.tokenHrA,
    body: { organizationId: String(state.orgB._id) },
  });

  assert.equal(response.status, 403);
});

// ── Role-based access ───────────────────────────────────────────────────────

test("an employee cannot reach an HR-only endpoint", async () => {
  const response = await api("GET", "/employees/stats/headcount", {
    token: state.tokenEmployeeA,
  });

  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, "PERMISSION_DENIED");
});

test("an employee cannot create another employee", async () => {
  const response = await api("POST", "/employees", {
    token: state.tokenEmployeeA,
    body: { personal: { firstName: "Sneaky" } },
  });

  assert.equal(response.status, 403);
});

test("an employee cannot invite users or change roles", async () => {
  const invite = await api("POST", "/users/invite", {
    token: state.tokenEmployeeA,
    body: { email: "friend@alpha.test", roleIds: [] },
  });
  assert.equal(invite.status, 403);

  const roles = await api("GET", "/roles", { token: state.tokenEmployeeA });
  assert.equal(roles.status, 403);
});

test("an employee cannot change organization settings", async () => {
  const response = await api("PATCH", "/organizations/current", {
    token: state.tokenEmployeeA,
    body: { name: "My Company Now" },
  });

  assert.equal(response.status, 403);
});

test("an employee sees only themselves in the employee list", async () => {
  const response = await api("GET", "/employees", { token: state.tokenEmployeeA });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.length, 1);
  assert.equal(response.body.data[0].employeeCode, "A0001");
  assert.equal(response.body.meta.total, 1, "the total reflects the scope, not the whole organization");
});

test("an employee cannot open a colleague's profile", async () => {
  const response = await api("GET", `/employees/${state.colleagueA._id}`, {
    token: state.tokenEmployeeA,
  });

  assert.equal(response.status, 404, "scoped out, and reported as missing");
});

test("an employee can read their own profile", async () => {
  const response = await api("GET", "/employees/me", { token: state.tokenEmployeeA });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.employeeCode, "A0001");
  assert.equal(response.body.data.bank.accountNumber, "1234567890", "own bank details are visible");
});

test("HR with the sensitive-data permission sees bank details; a manager without it does not", async () => {
  const asHr = await api("GET", `/employees/${state.colleagueA._id}`, { token: state.tokenHrA });
  assert.equal(asHr.status, 200);
  assert.equal(asHr.body.data.bank.accountNumber, "9999888877");

  // Strip the sensitive permission from the HR admin's role and try again.
  await tenant.runWithTenant(state.orgA._id, async () => {
    const membership = await Membership.findOne({ userId: state.orgA.ownerUserId });
    membership.permissions = membership.permissions.filter((p) => p !== "employee.view_sensitive");
    await membership.save();
    rbac.invalidateUser(String(state.orgA._id), String(state.orgA.ownerUserId));
  });

  const withoutPermission = await api("GET", `/employees/${state.colleagueA._id}`, {
    token: state.tokenHrA,
  });

  assert.equal(withoutPermission.status, 200);
  assert.equal(withoutPermission.body.data.bank, undefined, "bank details are stripped on the way out");
  assert.equal(withoutPermission.body.data.sensitiveHidden, true);
});

test("removing a membership revokes access immediately, without waiting for the token to expire", async () => {
  const before = await api("GET", "/employees/me", { token: state.tokenEmployeeA });
  assert.equal(before.status, 200);

  await tenant.runWithTenant(state.orgA._id, async () => {
    await Membership.updateOne({ userId: state.raviUser._id }, { $set: { status: "removed" } });
    rbac.invalidateUser(String(state.orgA._id), String(state.raviUser._id));
  });

  const after = await api("GET", "/employees/me", { token: state.tokenEmployeeA });
  assert.equal(after.status, 401, "the same token no longer works");
});

test("a suspended organization blocks its own users", async () => {
  await Organization.updateOne(
    { _id: state.orgA._id },
    { $set: { status: "suspended", suspendedReason: "Non-payment" } }
  );
  require("../../src/modules/auth/authenticate").invalidateOrganizationCache(state.orgA._id);

  const response = await api("GET", "/employees/me", { token: state.tokenEmployeeA });
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, "ORGANIZATION_SUSPENDED");

  const otherTenant = await api("GET", "/departments", { token: state.tokenHrB });
  assert.equal(otherTenant.status, 200, "the other tenant is unaffected");
});

// ── The platform control plane ──────────────────────────────────────────────

test("a tenant user gets a 404 from the platform routes, not a 403", async () => {
  const response = await api("GET", "/platform/organizations", { token: state.tokenHrA });

  // A customer should not learn that a control plane exists.
  assert.equal(response.status, 404);
});

// ── Validation ──────────────────────────────────────────────────────────────

test("an invalid payload returns a field-level validation error", async () => {
  const response = await api("POST", "/departments", {
    token: state.tokenHrA,
    body: { name: "", code: "" },
  });

  assert.equal(response.status, 422);
  assert.equal(response.body.error.code, "VALIDATION_ERROR");
  assert.ok(response.body.error.details.length >= 2);
  assert.ok(response.body.error.details.every((d) => d.field && d.message));
});

test("unknown keys in a payload are stripped rather than stored", async () => {
  const response = await api("POST", "/departments", {
    token: state.tokenHrA,
    body: { name: "Alpha Finance", code: "FIN", organizationId: String(state.orgB._id), isSystem: true },
  });

  assert.equal(response.status, 201);
  assert.equal(String(response.body.data.organizationId), String(state.orgA._id));
});

test("a bad id in the path is a clean 400, not a crash", async () => {
  const response = await api("GET", "/departments/not-an-id", { token: state.tokenHrA });
  assert.equal(response.status, 422);
  assert.equal(response.body.error.code, "VALIDATION_ERROR");
});

test("every response carries a request id for correlation", async () => {
  const response = await fetch(`${baseUrl}/departments`, {
    headers: { Authorization: `Bearer ${state.tokenHrA}` },
  });
  assert.ok(response.headers.get("x-request-id"));
});
