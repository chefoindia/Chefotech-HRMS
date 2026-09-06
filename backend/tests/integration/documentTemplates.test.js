"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { startDatabase, stopDatabase, clearDatabase } = require("../helpers/db");
const { createApp } = require("../../src/app");
const User = require("../../src/modules/users/user.model");
const organizationService = require("../../src/modules/organizations/organization.service");

/**
 * The document template editor (frontend/app/app/documents/templates/[id])
 * is built entirely around `template.id` — every read, write, and the
 * `router.push` after creating one. `getTemplate`/`listTemplates` use
 * `.lean()` internally (needed so `generate()` can still reach the real
 * `_id` afterward to increment a numbering counter), which skips the
 * schema's usual `_id` → `id` rename — exactly the class of bug already
 * found once in crudFactory.js's list endpoint. These tests are the guard
 * for the same mistake in this module.
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

  const owner = new User({ email: "hr@templates.test", firstName: "Priya", lastName: "Shah", status: "active", emailVerifiedAt: new Date() });
  await owner.setPassword("Password@12345");
  await owner.save();

  await organizationService.provision({ name: "Template Testing Co", ownerUserId: owner._id });

  const login = await api("POST", "/auth/login", { body: { email: "hr@templates.test", password: "Password@12345" } });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  state.token = login.body.data.accessToken;
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

test("a created template's response has id, not _id", async () => {
  const response = await api("POST", "/documents/templates", {
    token: state.token,
    body: { name: "Offer letter", code: "OFFER", category: "offer_letter", blocks: [] },
  });

  assert.equal(response.status, 201);
  assert.equal(typeof response.body.data.id, "string");
  assert.equal(response.body.data._id, undefined);
});

test("the template list has id on every row, not _id", async () => {
  await api("POST", "/documents/templates", { token: state.token, body: { name: "A", code: "A1", blocks: [] } });
  await api("POST", "/documents/templates", { token: state.token, body: { name: "B", code: "B1", blocks: [] } });

  const response = await api("GET", "/documents/templates", { token: state.token });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.length, 2);
  for (const row of response.body.data) {
    assert.equal(typeof row.id, "string", "the editor's `router.push` and every fetch after it depend on this");
    assert.equal(row._id, undefined);
  }
});

test("fetching one template by id has id, not _id, and the real block content", async () => {
  const created = await api("POST", "/documents/templates", {
    token: state.token,
    body: {
      name: "Experience letter",
      code: "EXP",
      blocks: [{ type: "heading", text: "To Whom It May Concern" }, { type: "spacer", height: 20 }],
    },
  });

  const fetched = await api("GET", `/documents/templates/${created.body.data.id}`, { token: state.token });

  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.data.id, created.body.data.id);
  assert.equal(fetched.body.data._id, undefined);
  assert.equal(fetched.body.data.blocks.length, 2);
  assert.equal(fetched.body.data.blocks[0].text, "To Whom It May Concern");
});

test("editing blocks and saving round-trips exactly what was sent", async () => {
  const created = await api("POST", "/documents/templates", {
    token: state.token,
    body: { name: "Draft", code: "DRAFT1", blocks: [] },
  });
  const id = created.body.data.id;

  const updated = await api("PATCH", `/documents/templates/${id}`, {
    token: state.token,
    body: {
      blocks: [
        { type: "table", source: "payslip.earnings", columns: [{ key: "name", label: "Component" }, { key: "amount", label: "Amount" }] },
        { type: "key_values", rows: [{ label: "PAN", value: "{{employee.pan}}" }] },
      ],
    },
  });

  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.blocks.length, 2);
  assert.equal(updated.body.data.blocks[0].source, "payslip.earnings");
  assert.equal(updated.body.data.blocks[1].rows[0].label, "PAN");

  const refetched = await api("GET", `/documents/templates/${id}`, { token: state.token });
  assert.equal(refetched.body.data.blocks[0].columns[1].key, "amount");
});

test("preview never consumes a document number; a real generation consumes exactly one", async () => {
  // Two guards in one. getTemplate() must still return the real Mongo _id for
  // generate()'s own internal `updateOne({ _id: ... })` call, even though
  // the HTTP response for the same read is transformed to `id` — if a future
  // change moved the transform inside the service function, numbering would
  // silently stop. And preview must be a dry run: it used to advance the
  // counter every time somebody looked, so the offer letters a customer
  // actually sent had gaps in their reference numbers.
  const created = await api("POST", "/documents/templates", {
    token: state.token,
    body: {
      name: "Numbered letter",
      code: "NUM1",
      contextType: "organization",
      numbering: { enabled: true, prefix: "OL/", nextNumber: 1, padding: 3 },
      blocks: [{ type: "paragraph", text: "Document number: {{document.number}}" }],
    },
  });
  const templateId = created.body.data.id;

  const preview = await api("POST", "/documents/generate/preview", { token: state.token, body: { templateId } });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));

  const afterPreview = await api("GET", `/documents/templates/${templateId}`, { token: state.token });
  assert.equal(afterPreview.body.data.numbering.nextNumber, 1, "a preview must not advance the counter");

  const employee = await api("POST", "/employees", {
    token: state.token,
    body: { personal: { firstName: "Ravi", lastName: "Kumar" }, employment: { joiningDate: "2026-01-05" } },
  });
  assert.equal(employee.status, 201, JSON.stringify(employee.body));

  const generated = await api("POST", "/documents/generate", {
    token: state.token,
    body: { templateId, employeeId: employee.body.data.id },
  });
  assert.equal(generated.status, 201, JSON.stringify(generated.body));
  assert.equal(generated.body.data.document.documentNumber, "OL/001");
  assert.equal(typeof generated.body.data.document.verification.code, "string", "a generated document carries a verification code");

  const afterGenerate = await api("GET", `/documents/templates/${templateId}`, { token: state.token });
  assert.equal(afterGenerate.body.data.numbering.nextNumber, 2, "one generation must advance the counter exactly once");
});

test("a generated document can be verified publicly by its code, revealing nothing personal", async () => {
  const created = await api("POST", "/documents/templates", {
    token: state.token,
    body: { name: "Certificate", code: "CERT1", contextType: "employee", blocks: [{ type: "paragraph", text: "{{employee.name}}" }] },
  });
  const employee = await api("POST", "/employees", {
    token: state.token,
    body: { personal: { firstName: "Meera", lastName: "Nair" }, employment: { joiningDate: "2025-06-01" } },
  });
  const generated = await api("POST", "/documents/generate", {
    token: state.token,
    body: { templateId: created.body.data.id, employeeId: employee.body.data.id },
  });
  const code = generated.body.data.document.verification.code;

  const verified = await api("GET", `/public/verify/${code}`);
  assert.equal(verified.status, 200);
  assert.equal(verified.body.data.valid, true);
  assert.equal(verified.body.data.documentName, "Certificate");
  assert.ok(!JSON.stringify(verified.body.data).includes("Meera"), "the verify page must not expose the employee");

  const bogus = await api("GET", "/public/verify/ZZZZZZZZZZ");
  assert.equal(bogus.status, 200);
  assert.equal(bogus.body.data.valid, false);
});
