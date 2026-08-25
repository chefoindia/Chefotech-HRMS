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

test("a template's own numbering still increments correctly after the id fix", async () => {
  // Regression guard: getTemplate() must still return the real Mongo _id for
  // generate()'s own internal `updateOne({ _id: ... })` call, even though
  // the HTTP response for the same read is transformed to `id`. If a future
  // change moved the transform inside the service function instead of the
  // route handler, this would silently stop numbering documents.
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

  const first = await api("POST", "/documents/generate/preview", {
    token: state.token,
    body: { templateId: created.body.data.id },
  });
  assert.equal(first.status, 200);

  const afterFirst = await api("GET", `/documents/templates/${created.body.data.id}`, { token: state.token });
  assert.equal(afterFirst.body.data.numbering.nextNumber, 2, "one preview must advance the counter exactly once");
});
