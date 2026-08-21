"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/**
 * The mobile app's API calls must hit routes that exist.
 *
 * This is the same failure that produced the tour 404s and the onboarding
 * 404s, one layer down: a client hard-codes a path, the server renames or
 * never had it, and nothing fails until a user taps the button. On a phone it
 * is worse than on the web, because the fix ships through an app store review
 * rather than a deploy.
 *
 * So every path the app calls is extracted from its source and checked against
 * the routes the Express app actually mounts.
 *
 * Skips when the mobile project is absent, so the backend can be built and
 * tested on its own.
 */

const MOBILE = path.resolve(__dirname, "../../../mobile");
const mobilePresent = fs.existsSync(path.join(MOBILE, "src", "api"));

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * Every route the API mounts, as `METHOD /prefixed/path`, with parameters
 * collapsed to `*` so `/payslips/:id` and `/payslips/abc123` compare equal.
 */
function serverRoutes() {
  const routes = new Set();
  const SRC = path.resolve(__dirname, "../../src");

  // Mount prefixes come from routes.js, so a module remounted elsewhere is
  // picked up rather than assumed.
  const routesFile = fs.readFileSync(path.join(SRC, "routes.js"), "utf8");
  const mounts = [...routesFile.matchAll(/router\.use\(\s*"([^"]+)"\s*,\s*require\("([^"]+)"\)/g)];

  for (const [, prefix, modulePath] of mounts) {
    const file = path.resolve(SRC, modulePath) + ".js";
    if (!fs.existsSync(file)) continue;
    const code = fs.readFileSync(file, "utf8");

    for (const match of code.matchAll(
      /router\s*\.\s*(get|post|put|patch|delete)\s*\(\s*\n?\s*"([^"]*)"/g
    )) {
      const [, method, routePath] = match;
      const full = `${prefix}${routePath === "/" ? "" : routePath}`;
      routes.add(`${method.toUpperCase()} ${normalise(full)}`);
    }
  }

  return routes;
}

/** Collapse express params and template placeholders alike. */
function normalise(routePath) {
  return routePath
    .split("?")[0]
    .replace(/\/+$/, "")
    .split("/")
    .map((segment) => (segment.startsWith(":") || segment.startsWith("${") ? "*" : segment))
    .join("/");
}

/** Every API path the mobile app calls, with its method. */
function mobileCalls() {
  const calls = [];
  const files = walk(path.join(MOBILE, "src")).concat(
    fs.existsSync(path.join(MOBILE, "app")) ? walk(path.join(MOBILE, "app")) : []
  );

  for (const file of files) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    const code = fs.readFileSync(file, "utf8");

    // api.get("/path"), api.post(`/path/${id}`), api.fileUrl(`/path`)
    for (const match of code.matchAll(
      /api\s*\.\s*(get|post|patch|delete|fileUrl)\s*(?:<[^>]*>)?\s*\(\s*[`"]([^`"]+)[`"]/g
    )) {
      const [, method, calledPath] = match;
      if (!calledPath.startsWith("/")) continue;
      calls.push({
        method: method === "fileUrl" ? "GET" : method.toUpperCase(),
        path: normalise(calledPath),
        file: path.relative(MOBILE, file),
      });
    }
  }

  return calls;
}

test("mobile API contract", { skip: mobilePresent ? false : "mobile app not present" }, async (t) => {
  const routes = serverRoutes();

  await t.test("the server route table was actually discovered", () => {
    // Guards the guard: a broken parse would make the assertion below vacuous.
    assert.ok(routes.size > 50, `expected a real route table, found ${routes.size}`);
    assert.ok(routes.has("POST /auth/login"), "login should be a discovered route");
  });

  await t.test("the app calls a meaningful number of endpoints", () => {
    const calls = mobileCalls();
    assert.ok(calls.length >= 10, `expected the app to call several endpoints, found ${calls.length}`);
  });

  await t.test("every endpoint the app calls exists on the server", () => {
    const missing = mobileCalls().filter(
      (call) => !routes.has(`${call.method} ${call.path}`)
    );

    assert.deepEqual(
      missing,
      [],
      `the mobile app calls endpoints that do not exist:\n${JSON.stringify(missing, null, 2)}`
    );
  });
});
