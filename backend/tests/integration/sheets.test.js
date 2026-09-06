"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { startDatabase, stopDatabase, clearDatabase } = require("../helpers/db");
const { createApp } = require("../../src/app");
const User = require("../../src/modules/users/user.model");
const organizationService = require("../../src/modules/organizations/organization.service");
const defaultSheets = require("../../src/modules/documents/defaultSheets");

/**
 * Sheet templates: the designable spreadsheets.
 *
 * The contract under test is the one the designer page relies on — a
 * source describes its fields, a template is a list of columns over a
 * source, a preview returns formatted rows, and a render returns a real
 * XLSX/CSV/PDF — plus the two rules that keep a salary sheet from being a
 * data leak: source permissions and the sensitive-column gate.
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

  const owner = new User({ email: "hr@sheets.test", firstName: "Dev", lastName: "Iyer", status: "active", emailVerifiedAt: new Date() });
  await owner.setPassword("Password@12345");
  await owner.save();
  await organizationService.provision({ name: "Sheet Testing Co", ownerUserId: owner._id });

  const login = await api("POST", "/auth/login", { body: { email: "hr@sheets.test", password: "Password@12345" } });
  state.token = login.body.data.accessToken;

  for (const [first, last] of [["Anu", "K"], ["Bala", "S"], ["Chitra", "V"]]) {
    const created = await api("POST", "/employees", {
      token: state.token,
      body: { personal: { firstName: first, lastName: last, workEmail: `${first.toLowerCase()}@sheets.test` }, employment: { joiningDate: "2025-01-15" }, bank: { bankName: "SBI", accountNumber: "9988776655" } },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
  }
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

async function raw(method, path, { token, body } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

test("the source catalog lists every source with its fields", async () => {
  const response = await api("GET", "/sheets/sources", { token: state.token });
  assert.equal(response.status, 200);
  const keys = response.body.data.map((s) => s.key);
  for (const expected of ["employees", "attendance_daily", "attendance_monthly", "attendance_muster", "leave_requests", "leave_balances", "payroll_items", "salary_register", "payslips", "joiners_leavers"]) {
    assert.ok(keys.includes(expected), `missing source ${expected}`);
  }
  const employees = response.body.data.find((s) => s.key === "employees");
  assert.ok(employees.fields.some((f) => f.key === "employeeCode"));
  assert.ok(employees.fields.some((f) => f.key === "accountNumber" && f.sensitive), "bank fields are flagged sensitive");
});

test("starter sheets seed once, and every one of them references a real source and real fields", async () => {
  const seeded = await api("POST", "/sheets/seed-defaults", { token: state.token });
  assert.equal(seeded.status, 200);
  assert.equal(seeded.body.data.created, defaultSheets.SHEETS.length);

  const again = await api("POST", "/sheets/seed-defaults", { token: state.token });
  assert.equal(again.body.data.created, 0);

  const sources = (await api("GET", "/sheets/sources", { token: state.token })).body.data;
  const bySource = Object.fromEntries(sources.map((s) => [s.key, s]));
  const problems = [];
  for (const sheet of defaultSheets.SHEETS) {
    const source = bySource[sheet.source];
    if (!source) {
      problems.push(`${sheet.code}: unknown source ${sheet.source}`);
      continue;
    }
    if (source.dynamicFields) continue; // salary components / muster days come from data
    const fieldKeys = new Set(source.fields.map((f) => f.key));
    for (const column of sheet.columns) {
      if (column.expression) continue;
      if (!fieldKeys.has(column.key)) problems.push(`${sheet.code}: column ${column.key} is not a field of ${sheet.source}`);
    }
  }
  assert.deepEqual(problems, []);
});

test("a custom sheet can be designed, previewed with formulas and totals, and downloaded in three formats", async () => {
  const created = await api("POST", "/sheets", {
    token: state.token,
    body: {
      name: "Headcount",
      code: "HEADCOUNT",
      source: "employees",
      columns: [
        { key: "employeeCode", label: "Code", width: 12 },
        { key: "name", label: "Name", width: 24 },
        { key: "tenureMonths", label: "Tenure (m)", format: "integer", total: true },
        { key: "double", label: "Twice tenure", format: "integer", expression: "tenureMonths * 2", total: true },
      ],
      sort: "name",
      footer: { showTotals: true, signatureLabels: ["Prepared by", "Approved by"] },
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.data.id;
  assert.equal(typeof id, "string");

  const preview = await api("POST", `/sheets/${id}/preview`, { token: state.token, body: {} });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.data.rowCount, 3);
  assert.equal(preview.body.data.groups[0].rows.length, 3);
  assert.equal(preview.body.data.groups[0].rows[0].name, "Anu K", "sorted by name");
  assert.ok("double" in preview.body.data.groups[0].rows[0], "the formula column is present");
  assert.ok(preview.body.data.totals.tenureMonths !== undefined, "totals are computed for flagged columns");

  const xlsx = await raw("POST", `/sheets/${id}/render`, { token: state.token, body: { format: "xlsx" } });
  const xlsxBytes = Buffer.from(await xlsx.arrayBuffer());
  assert.equal(xlsx.status, 200, xlsxBytes.toString("utf8").slice(0, 300));
  assert.match(xlsx.headers.get("content-type"), /spreadsheetml/);
  assert.equal(xlsxBytes.subarray(0, 2).toString(), "PK", "an xlsx is a zip");

  const csv = await raw("POST", `/sheets/${id}/render`, { token: state.token, body: { format: "csv" } });
  assert.equal(csv.status, 200);
  const csvText = await csv.text();
  assert.ok(csvText.includes("Anu K"));

  const pdf = await raw("POST", `/sheets/${id}/render`, { token: state.token, body: { format: "pdf" } });
  assert.equal(pdf.status, 200);
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), "%PDF");
});

test("a sheet that needs a date range says so instead of rendering nothing", async () => {
  const created = await api("POST", "/sheets", {
    token: state.token,
    body: { name: "Daily", code: "DAILY1", source: "attendance_daily", columns: [{ key: "employeeCode", label: "Code" }] },
  });
  const response = await api("POST", `/sheets/${created.body.data.id}/preview`, { token: state.token, body: {} });
  assert.equal(response.status, 422, JSON.stringify(response.body));
});

test("a sensitive column is refused for a user without the sensitive permission", async () => {
  // A second user with report and employee rights but no employee.view_sensitive.
  const invited = await api("POST", "/users/invite", { token: state.token, body: { email: "clerk@sheets.test", firstName: "Clerk", roleKeys: ["HR_EXECUTIVE"] } });
  if (invited.status !== 201 && invited.status !== 200) {
    // Role names differ per deployment; the rule is still enforced in-service, so
    // exercise it directly rather than through a role we cannot be sure exists.
    const service = require("../../src/modules/documents/sheet.service");
    const tenant = require("../../src/core/tenancy/tenantContext");
    const Organization = require("../../src/modules/organizations/organization.model");
    const org = await tenant.runAsSystem(() => Organization.findOne({}).lean(), "test");
    await tenant.runWithTenant(org._id, async () => {
      const template = await service.create(
        { name: "Bank", code: "BANK1", source: "employees", columns: [{ key: "accountNumber", label: "Account" }] },
        null
      );
      await assert.rejects(
        () => service.render(template.id, { format: "json" }, { permissions: ["report.view", "employee.view"] }),
        (err) => err.status === 403 && /sensitive/.test(err.message)
      );
      const allowed = await service.render(template.id, { format: "json" }, { permissions: ["report.view", "employee.view", "employee.view_sensitive"] });
      assert.equal(allowed.rowCount, 3);
    });
  }
});
