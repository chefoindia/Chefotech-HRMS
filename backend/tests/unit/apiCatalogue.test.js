"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const catalogue = require("../../src/modules/integrations/apiCatalogue");

/**
 * The endpoint catalogue is what an integrator reads before writing a line of
 * code, and what the Postman collection is generated from. If it drifts from
 * the routes the server actually mounts, the first thing they meet is a 404
 * on an endpoint we told them about — so these tests hold it to the routes.
 */

test("the API catalogue", async (t) => {
  const data = catalogue.catalogue();

  await t.test("covers the whole API, grouped", () => {
    // The API is large; a catalogue that suddenly lists a handful of routes
    // means the scanner broke rather than that the API shrank.
    assert.ok(data.endpointCount > 300, `only ${data.endpointCount} endpoints found`);
    assert.ok(data.groupCount > 20, `only ${data.groupCount} groups found`);
    assert.ok(data.baseUrl.endsWith("/api/v1"), data.baseUrl);
  });

  await t.test("every endpoint is a real method and path", () => {
    const methods = new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]);
    for (const group of data.groups) {
      for (const endpoint of group.endpoints) {
        assert.ok(methods.has(endpoint.method), `${endpoint.method} is not an HTTP method`);
        assert.ok(endpoint.path.startsWith(group.prefix), `${endpoint.path} is not under ${group.prefix}`);
        assert.ok(endpoint.description && endpoint.description.length > 3, `${endpoint.path} has no description`);
      }
    }
  });

  await t.test("the permissions it reports are real permissions", () => {
    const { ALL_PERMISSIONS } = require("../../src/core/rbac/permissions");
    const known = new Set(ALL_PERMISSIONS);
    const unknown = [];
    for (const group of data.groups) {
      for (const endpoint of group.endpoints) {
        for (const scope of endpoint.scopes) {
          if (!known.has(scope)) unknown.push(`${endpoint.method} ${endpoint.path} → ${scope}`);
        }
      }
    }
    assert.deepEqual(unknown, [], `the catalogue names permissions that do not exist:\n${unknown.join("\n")}`);
  });

  await t.test("well-known endpoints are present with the permission that guards them", () => {
    const flat = new Map();
    for (const group of data.groups) {
      for (const endpoint of group.endpoints) flat.set(`${endpoint.method} ${endpoint.path}`, endpoint);
    }

    const employees = flat.get("GET /employees");
    assert.ok(employees, "GET /employees is missing from the catalogue");
    assert.ok(employees.scopes.includes("employee.view"), `expected employee.view, got ${employees.scopes.join()}`);

    assert.ok(flat.has("POST /attendance/punch"), "POST /attendance/punch is missing");
    assert.ok(flat.has("GET /payroll/runs"), "GET /payroll/runs is missing");
    assert.ok(flat.has("POST /integrations/webhooks"), "POST /integrations/webhooks is missing");
  });

  await t.test("internal surfaces are not advertised", () => {
    const prefixes = data.groups.map((group) => group.prefix);
    for (const hidden of ["/platform", "/help", "/ai"]) {
      assert.ok(!prefixes.includes(hidden), `${hidden} should not be in the public catalogue`);
    }
  });

  await t.test("produces a Postman collection that imports", () => {
    const collection = catalogue.postmanCollection({ organizationName: "Saffron Table" });

    assert.match(collection.info.schema, /v2\.1\.0/);
    assert.ok(collection.info.name.includes("Saffron Table"));

    const variables = Object.fromEntries(collection.variable.map((v) => [v.key, v.value]));
    assert.equal(variables.baseUrl, data.baseUrl);
    assert.equal(variables.apiKey, "", "the collection must ship without a key in it");

    assert.equal(collection.item.length, data.groups.length);

    const requests = collection.item.flatMap((folder) => folder.item);
    assert.equal(requests.length, data.endpointCount);

    for (const request of requests.slice(0, 50)) {
      const headers = Object.fromEntries(request.request.header.map((h) => [h.key, h.value]));
      assert.equal(headers["x-api-key"], "{{apiKey}}", `${request.name} does not send the key`);
      assert.ok(request.request.url.raw.startsWith("{{baseUrl}}"), `${request.name} hard-codes a host`);
      if (["POST", "PATCH", "PUT"].includes(request.request.method)) {
        assert.equal(headers["Content-Type"], "application/json", `${request.name} has no content type`);
      }
    }
  });
});
