"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { startDatabase, stopDatabase, clearDatabase } = require("../helpers/db");
const { createApp } = require("../../src/app");
const User = require("../../src/modules/users/user.model");
const organizationService = require("../../src/modules/organizations/organization.service");
const tenant = require("../../src/core/tenancy/tenantContext");
const documentService = require("../../src/modules/documents/document.service");
const defaultTemplates = require("../../src/modules/documents/defaultTemplates");
const { getPath } = require("../../src/modules/documents/pdfRenderer");

/**
 * Every placeholder a starter template uses must be something buildContext
 * actually supplies. A placeholder that resolves to nothing renders as an
 * empty string — an offer letter that says "your notice period is  days"
 * goes out looking exactly like one that worked, which is why this is a
 * test and not a code review note.
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

  const owner = new User({ email: "hr@context.test", firstName: "Asha", lastName: "Rao", status: "active", emailVerifiedAt: new Date() });
  await owner.setPassword("Password@12345");
  await owner.save();

  const { organization } = await organizationService.provision({ name: "Context Testing Co", ownerUserId: owner._id });
  state.organizationId = organization._id;

  const login = await api("POST", "/auth/login", { body: { email: "hr@context.test", password: "Password@12345" } });
  state.token = login.body.data.accessToken;

  const employee = await api("POST", "/employees", {
    token: state.token,
    body: {
      personal: {
        firstName: "Kiran",
        lastName: "Mehta",
        gender: "female",
        dateOfBirth: "1992-04-18",
        workEmail: "kiran@context.test",
        phone: "9999999999",
        currentAddress: { line1: "12 Lake View", city: "Pune", state: "MH", postalCode: "411001" },
        emergencyContacts: [{ name: "Ravi Mehta", relationship: "Spouse", phone: "8888888888", isPrimary: true }],
      },
      employment: { joiningDate: "2024-02-01", employmentType: "full_time", probationMonths: 6, noticePeriodDays: 60 },
      bank: { bankName: "HDFC", accountNumber: "123456789012", ifscCode: "HDFC0000001" },
      statutory: { uan: "100200300400", pfNumber: "MH/PUN/12345/67" },
    },
  });
  assert.equal(employee.status, 201, JSON.stringify(employee.body));
  state.employeeId = employee.body.data.id;
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

function placeholdersIn(template) {
  const found = new Set();
  const walk = (value) => {
    if (typeof value === "string") {
      for (const match of value.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) found.add(match[1]);
    } else if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(walk);
    }
  };
  walk(template.blocks);
  walk(template.header);
  walk(template.footer);
  return [...found];
}

test("every placeholder in every starter template resolves against the context it renders with", async () => {
  const seeded = await api("POST", "/documents/templates/seed-defaults", { token: state.token });
  assert.equal(seeded.status, 200);
  assert.equal(seeded.body.data.created, defaultTemplates.TEMPLATES.length);

  const missing = [];
  await tenant.runWithTenant(state.organizationId, async () => {
    for (const template of defaultTemplates.TEMPLATES) {
      // Payslip and leave letters take their own ids; without one their
      // sections are simply absent, which is the documented behaviour, so
      // those namespaces are exempt here and covered by the render test below.
      const context = await documentService.buildContext(template, { employeeId: state.employeeId });
      context.document = { number: "X", verificationCode: "Y", templateName: template.name };

      for (const path of placeholdersIn(template)) {
        if (path.startsWith("payslip.") || path.startsWith("leave.")) continue;
        // Table-row placeholders ("amount", "label") resolve per row, not at the top.
        if (!path.includes(".")) continue;
        const value = getPath(context, path);
        if (value === undefined) missing.push(`${template.code}: {{${path}}}`);
      }
      for (const block of template.blocks || []) {
        if (block.source && !block.source.startsWith("payslip.")) {
          const rows = getPath(context, block.source);
          if (!Array.isArray(rows)) missing.push(`${template.code}: table source "${block.source}" is not a list`);
        }
      }
    }
  });

  assert.deepEqual(missing, [], `Placeholders with no value in the context:\n${missing.join("\n")}`);
});

test("every starter template renders to a PDF for a real employee", async () => {
  await api("POST", "/documents/templates/seed-defaults", { token: state.token });
  const list = await api("GET", "/documents/templates", { token: state.token });
  assert.ok(list.body.data.length >= 20);

  for (const template of list.body.data) {
    const response = await fetch(`${baseUrl}/documents/generate/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.token}` },
      body: JSON.stringify({ templateId: template.id, employeeId: state.employeeId }),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, 200, `${template.code} did not render: ${bytes.toString("utf8").slice(0, 300)}`);
    assert.equal(bytes.subarray(0, 4).toString(), "%PDF", `${template.code} is not a PDF`);
  }
});

test("a template edit keeps the previous version, which can be restored", async () => {
  const created = await api("POST", "/documents/templates", {
    token: state.token,
    body: { name: "Letter", code: "VER1", blocks: [{ type: "paragraph", text: "Version one" }] },
  });
  const id = created.body.data.id;

  const edited = await api("PATCH", `/documents/templates/${id}`, {
    token: state.token,
    body: { blocks: [{ type: "paragraph", text: "Version two" }], changeNote: "Reworded" },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.data.version, 2);

  const versions = await api("GET", `/documents/templates/${id}/versions`, { token: state.token });
  assert.equal(versions.status, 200);
  assert.equal(versions.body.data.length, 1);
  assert.equal(versions.body.data[0].version, 1);

  const restored = await api("POST", `/documents/templates/${id}/versions/${versions.body.data[0].id}/restore`, { token: state.token });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.data.blocks[0].text, "Version one");
  assert.equal(restored.body.data.version, 3, "a restore is itself a new version, so nothing is ever lost");
});

test("export produces a portable file that import accepts under a fresh code", async () => {
  const created = await api("POST", "/documents/templates", {
    token: state.token,
    body: { name: "Portable", code: "PORT1", blocks: [{ type: "heading", text: "Hello {{employee.name}}" }] },
  });
  const exported = await fetch(`${baseUrl}/documents/templates/${created.body.data.id}/export`, {
    headers: { Authorization: `Bearer ${state.token}` },
  });
  assert.equal(exported.status, 200);
  const payload = await exported.json();
  assert.equal(payload.format, "chefotech.document-template");
  assert.equal(payload.template.organizationId, undefined, "an export must not carry tenancy");

  const imported = await api("POST", "/documents/templates/import", { token: state.token, body: payload });
  assert.equal(imported.status, 201, JSON.stringify(imported.body));
  assert.notEqual(imported.body.data.code, "PORT1", "a clashing code is renamed rather than rejected");
  assert.equal(imported.body.data.blocks[0].text, "Hello {{employee.name}}");
});

test("document requests reach the employee and are closed by their upload", async () => {
  const requested = await api("POST", "/documents/requests", {
    token: state.token,
    body: { employeeIds: [state.employeeId], name: "PAN card", category: "identity", dueOn: "2030-01-01" },
  });
  assert.equal(requested.status, 201, JSON.stringify(requested.body));
  assert.equal(requested.body.data.created, 1);

  const pending = await api("GET", "/documents/requests", { token: state.token, });
  assert.equal(pending.body.data.length, 1);
  assert.equal(pending.body.data[0].status, "pending");
  const requestId = pending.body.data[0].id;

  // HR uploads on the employee's behalf against the request.
  const form = new FormData();
  form.append("file", new Blob(["%PDF-1.4 fake"], { type: "application/pdf" }), "pan.pdf");
  form.append("requestId", requestId);
  form.append("visibleToEmployee", "false");
  const upload = await fetch(`${baseUrl}/documents/employee/${state.employeeId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${state.token}` },
    body: form,
  });
  const uploadText = await upload.text();
  assert.equal(upload.status, 201, uploadText);
  const uploaded = JSON.parse(uploadText);
  assert.equal(uploaded.data.name, "PAN card", "the request names the document");
  assert.equal(uploaded.data.category, "identity");
  assert.equal(uploaded.data.visibleToEmployee, false, 'the multipart string "false" must mean false');

  const after = await api("GET", "/documents/requests", { token: state.token });
  assert.equal(after.body.data[0].status, "fulfilled");
});

test("company documents are published, audience-filtered and acknowledged once per person", async () => {
  const form = new FormData();
  form.append("file", new Blob(["%PDF-1.4 handbook"], { type: "application/pdf" }), "handbook.pdf");
  form.append("title", "Employee handbook");
  form.append("category", "handbook");
  form.append("requireAcknowledgement", "true");
  form.append("departmentIds", "[]");
  const published = await fetch(`${baseUrl}/documents/company`, {
    method: "POST",
    headers: { Authorization: `Bearer ${state.token}` },
    body: form,
  });
  const publishedText = await published.text();
  assert.equal(published.status, 201, publishedText);
  const document = JSON.parse(publishedText).data;
  assert.equal(document.requireAcknowledgement, true);

  const first = await api("POST", `/documents/company/${document.id}/acknowledge`, { token: state.token, body: { name: "Asha Rao" } });
  assert.equal(first.status, 200);
  await api("POST", `/documents/company/${document.id}/acknowledge`, { token: state.token, body: { name: "Asha Rao" } });

  const list = await api("GET", "/documents/company", { token: state.token });
  assert.equal(list.body.data[0].acknowledgedCount, 1, "acknowledging twice counts once");
  assert.equal(list.body.data[0].acknowledged, true);
});
