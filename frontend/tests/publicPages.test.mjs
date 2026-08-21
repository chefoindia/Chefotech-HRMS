import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The public site cannot ship a dead link.
 *
 * The marketing pages, the footer and the legal index are the first thing a
 * prospective customer, a procurement reviewer or a regulator sees. A "Terms"
 * link that goes to "#" reads as an unfinished or non-compliant product long
 * before anyone reaches the application.
 *
 * This walks the real source: every internal href in the marketing components
 * and public pages is resolved against the routes that actually exist, and
 * every legal document referenced from anywhere must be a real document.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const APP_DIR = path.join(ROOT, "app");

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Routes the app router serves; dynamic segments collapse to "*". */
function routeTable() {
  const routes = new Set();
  for (const file of walk(APP_DIR)) {
    if (!/[\\/]page\.(tsx|jsx|ts|js)$/.test(file)) continue;
    const rel = path.relative(APP_DIR, path.dirname(file)).split(path.sep).filter(Boolean);
    const segments = rel
      .filter((segment) => !/^\(.*\)$/.test(segment))
      .map((segment) => (/^\[.*\]$/.test(segment) ? "*" : segment));
    routes.add("/" + segments.join("/"));
  }
  return routes;
}

function isServed(href, routes) {
  const [pathOnly] = String(href).split("?");
  const clean = pathOnly.split("#")[0].replace(/\/+$/, "") || "/";
  if (routes.has(clean)) return true;
  // A concrete id against a dynamic segment: /docs/quick-start -> /docs/*
  const parts = clean.split("/");
  for (let i = 1; i < parts.length; i += 1) {
    const candidate = [...parts.slice(0, i), "*", ...parts.slice(i + 1)].join("/");
    if (routes.has(candidate)) return true;
  }
  return false;
}

/** Internal hrefs written as string literals in a file. */
function hrefsIn(file) {
  const code = fs.readFileSync(file, "utf8");
  const found = new Set();
  for (const match of code.matchAll(/href=\{?"(\/[^"]*)"/g)) found.add(match[1]);
  // Footer/nav groups are arrays of ["Label", "/path"] pairs.
  for (const match of code.matchAll(/\["[^"]*",\s*"(\/[^"]*)"\]/g)) found.add(match[1]);
  // href: "/path" in config objects.
  for (const match of code.matchAll(/href:\s*"(\/[^"]*)"/g)) found.add(match[1]);
  return [...found];
}

const PUBLIC_SOURCES = [
  path.join(ROOT, "components", "marketing"),
  path.join(APP_DIR, "page.tsx"),
  path.join(APP_DIR, "legal"),
  path.join(APP_DIR, "docs"),
  path.join(APP_DIR, "support"),
  path.join(APP_DIR, "features"),
  path.join(APP_DIR, "pricing"),
  path.join(APP_DIR, "security"),
  path.join(APP_DIR, "about"),
  path.join(APP_DIR, "contact"),
  path.join(APP_DIR, "status"),
  path.join(APP_DIR, "not-found.tsx"),
];

function publicFiles() {
  const files = [];
  for (const source of PUBLIC_SOURCES) {
    if (!fs.existsSync(source)) continue;
    if (fs.statSync(source).isDirectory()) files.push(...walk(source));
    else files.push(source);
  }
  return files.filter((file) => /\.(tsx|jsx|ts)$/.test(file));
}

test("public site", async (t) => {
  const routes = routeTable();

  await t.test("the route table was actually discovered", () => {
    assert.ok(routes.size > 20, `expected a real route table, found ${routes.size}`);
    assert.ok(routes.has("/"), "the marketing home page should exist");
  });

  await t.test("every page the footer and header promise exists", () => {
    const broken = [];
    for (const file of publicFiles()) {
      for (const href of hrefsIn(file)) {
        if (!isServed(href, routes)) {
          broken.push({ file: path.relative(ROOT, file), href });
        }
      }
    }
    assert.deepEqual(
      broken,
      [],
      `public pages link to routes that do not exist:\n${JSON.stringify(broken, null, 2)}`
    );
  });

  await t.test("no public page still has a placeholder link", () => {
    // The specific regression: footer entries that pointed at "#".
    const offenders = [];
    for (const file of publicFiles()) {
      const code = fs.readFileSync(file, "utf8");
      for (const match of code.matchAll(/\["([^"]*)",\s*"(#[^"]*)?"\]/g)) {
        offenders.push({ file: path.relative(ROOT, file), label: match[1] });
      }
      for (const match of code.matchAll(/href=\{?"#"/g)) {
        offenders.push({ file: path.relative(ROOT, file), href: match[0] });
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `placeholder links remain:\n${JSON.stringify(offenders, null, 2)}`
    );
  });

  await t.test("the legal documents a business needs are all present", async () => {
    const source = fs.readFileSync(path.join(ROOT, "content", "legal.ts"), "utf8");
    const slugs = [...source.matchAll(/slug:\s*"([a-z-]+)"/g)].map((match) => match[1]);

    // Not arbitrary: terms and privacy are the baseline, a DPA and
    // sub-processor list are what a corporate customer's procurement asks
    // for, and refunds/cancellation is required by payment providers.
    for (const required of [
      "terms",
      "privacy",
      "cookies",
      "data-processing",
      "sub-processors",
      "acceptable-use",
      "sla",
      "refunds",
    ]) {
      assert.ok(slugs.includes(required), `missing legal document: ${required}`);
    }
  });

  await t.test("every legal document has a page that renders it", () => {
    assert.ok(
      routes.has("/legal/*"),
      "the /legal/[slug] route must exist or every legal link 404s"
    );
    assert.ok(routes.has("/legal"), "the legal index must exist");
  });

  await t.test("placeholders that must be replaced before launch are findable", () => {
    // These are intentional and documented, but they must never become
    // invisible — a published privacy policy naming "[CITY]" is worse than
    // one that was never published.
    const company = fs.readFileSync(path.join(ROOT, "content", "company.ts"), "utf8");
    assert.ok(
      company.includes("TODO"),
      "company.ts should keep its TODO markers until the real details are filled in"
    );
  });
});
