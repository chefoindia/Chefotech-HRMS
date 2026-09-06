"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { env } = require("../../config/env");

/**
 * What this API actually offers, read from the routes themselves.
 *
 * A hand-written endpoint list is wrong within a month: someone adds a route,
 * nobody updates the docs, and the first thing an integrator meets is a 404
 * on an endpoint we told them about. So the catalogue is derived from the
 * route files at boot — the same files Express mounts — and carries the
 * permission each route guards itself with, because "which scopes does my API
 * key need" is the question every integration starts with.
 *
 * Scanning source text rather than introspecting the mounted router is
 * deliberate: the permission lives in a `requirePermission("…")` middleware,
 * which the router keeps only as an anonymous function. The text has it.
 */

const ROUTE_RE = /router\s*\.\s*(get|post|put|patch|delete)\s*\(\s*\n?\s*"([^"]*)"/g;
const PERMISSION_RE = /requirePermission\(\s*"([^"]+)"/;
const ANY_PERMISSION_RE = /requireAnyPermission\(\s*([^)]*)\)/;

/** Modules an integrator has no business calling, and why they are hidden. */
const INTERNAL_PREFIXES = new Set(["/platform", "/help", "/ai", "/contact"]);

/**
 * Human labels for each mounted module. Anything not listed still appears,
 * titled from its prefix — a new module shows up unlabelled rather than
 * silently missing.
 */
const GROUPS = {
  "/auth": { title: "Authentication", blurb: "Sessions for people. API keys authenticate instead — see the guide." },
  "/organizations": { title: "Organization", blurb: "Your company profile, branding, usage and data export." },
  "/settings": { title: "Settings", blurb: "Every tenant setting, read and written by key." },
  "/users": { title: "Users", blurb: "Logins and their roles. Not the same as employees." },
  "/roles": { title: "Roles and permissions", blurb: "The permission catalogue and custom roles." },
  "/files": { title: "Files", blurb: "Upload and download stored files." },
  "/departments": { title: "Departments", blurb: "Departments and the org tree." },
  "/designations": { title: "Designations", blurb: "Job titles and grades." },
  "/locations": { title: "Locations", blurb: "Offices, plants and sites." },
  "/employees": { title: "Employees", blurb: "The people record: create, update, import, directory." },
  "/shifts": { title: "Shifts", blurb: "Shifts, rosters, patterns and weekly offs." },
  "/holidays": { title: "Holidays", blurb: "Calendars, holidays and the employee's own list." },
  "/attendance": { title: "Attendance", blurb: "Punches, daily records, corrections and policies." },
  "/biometric": { title: "Biometric devices", blurb: "Device registration and punch ingestion." },
  "/leave": { title: "Leave", blurb: "Types, policies, balances, requests and approvals." },
  "/workflows": { title: "Workflows", blurb: "Approval chains and pending approvals." },
  "/payroll": { title: "Payroll", blurb: "Components, structures, salaries, runs and payslips." },
  "/documents": { title: "Documents", blurb: "Templates, generation, employee documents and acknowledgements." },
  "/sheets": { title: "Sheets and reports", blurb: "Designable spreadsheets, rendering and schedules." },
  "/requests": { title: "Employee requests", blurb: "Work from home, comp-off, letters, advances." },
  "/tickets": { title: "Help desk", blurb: "Tickets, comments and SLAs." },
  "/expenses": { title: "Expenses", blurb: "Claims, approval and reimbursement." },
  "/assets": { title: "Assets", blurb: "Company assets and their assignments." },
  "/loans": { title: "Loans and advances", blurb: "Requests, schedules and repayments." },
  "/exits": { title: "Exits", blurb: "Resignations, clearance and settlement." },
  "/onboarding": { title: "Onboarding", blurb: "Joining checklists and their tasks." },
  "/surveys": { title: "Surveys", blurb: "Pulse surveys and their results." },
  "/performance": { title: "Performance", blurb: "Goals, review cycles and reviews." },
  "/notifications": { title: "Notifications", blurb: "In-app notices, announcements, mail log and push devices." },
  "/dashboard": { title: "Dashboard", blurb: "Aggregated figures for a home screen." },
  "/audit": { title: "Audit trail", blurb: "Who changed what, and when." },
  "/reports": { title: "Reports", blurb: "Prebuilt report data." },
  "/integrations": { title: "Integrations", blurb: "API keys and webhooks. Managed from the web app, never by an API key." },
  "/public": { title: "Public", blurb: "Unauthenticated endpoints, such as document verification." },
};

let cached = null;

/**
 * Split a routes file into one block per route declaration, so the
 * permission found inside a block belongs to that route and not the next one.
 */
function blocksFor(code) {
  const starts = [];
  ROUTE_RE.lastIndex = 0;
  let match;
  while ((match = ROUTE_RE.exec(code)) !== null) {
    starts.push({ index: match.index, method: match[1].toUpperCase(), routePath: match[2] });
  }
  return starts.map((start, i) => ({
    ...start,
    body: code.slice(start.index, i + 1 < starts.length ? starts[i + 1].index : code.length),
  }));
}

function permissionsIn(body) {
  const single = PERMISSION_RE.exec(body);
  if (single) return { scopes: [single[1]], mode: "all" };

  const any = ANY_PERMISSION_RE.exec(body);
  if (any) {
    const scopes = [...any[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    if (scopes.length) return { scopes, mode: "any" };
  }
  return { scopes: [], mode: "all" };
}

/** A one-line description derived from the JSDoc comment above a route, if any. */
function describe(body, method, routePath) {
  const comment = /\/\*\*([\s\S]*?)\*\//.exec(body.slice(0, 400));
  if (comment) {
    const first = comment[1]
      .split("\n")
      .map((line) => line.replace(/^\s*\*\s?/, "").trim())
      .filter(Boolean)[0];
    if (first && first.length > 3 && first.length < 160) return first;
  }
  const segments = routePath.split("/").filter(Boolean);
  const last = segments[segments.length - 1] || "collection";
  const isOne = last.startsWith(":");
  // "/employees/:id" reads better as "one employee" than as "id".
  const subject = isOne ? segments[segments.length - 2] || last.replace(/^:/, "") : last;
  const noun = subject.replace(/^:/, "").replace(/[-_]/g, " ");
  const singular = isOne ? `one ${noun.replace(/ies$/, "y").replace(/ses$/, "s").replace(/s$/, "")}` : noun;
  const verb = { GET: "Read", POST: "Create or act on", PATCH: "Update", PUT: "Replace", DELETE: "Remove" }[method];
  return `${verb} ${singular}`;
}

function build() {
  const src = path.resolve(__dirname, "../..");
  const routesFile = fs.readFileSync(path.join(src, "routes.js"), "utf8");
  const mounts = [...routesFile.matchAll(/router\.use\(\s*"([^"]+)"\s*,\s*require\("([^"]+)"\)/g)];

  const groups = [];
  let endpointCount = 0;

  for (const [, prefix, modulePath] of mounts) {
    if (INTERNAL_PREFIXES.has(prefix)) continue;

    const file = `${path.resolve(src, modulePath)}.js`;
    if (!fs.existsSync(file)) continue;

    const code = fs.readFileSync(file, "utf8");
    const endpoints = blocksFor(code).map((block) => {
      const full = `${prefix}${block.routePath === "/" ? "" : block.routePath}`;
      const { scopes, mode } = permissionsIn(block.body);
      return {
        method: block.method,
        path: full,
        scopes,
        scopeMode: mode,
        description: describe(block.body, block.method, full),
      };
    });

    if (!endpoints.length) continue;
    endpointCount += endpoints.length;

    const meta = GROUPS[prefix] || {};
    groups.push({
      prefix,
      title: meta.title || prefix.replace("/", "").replace(/^./, (c) => c.toUpperCase()),
      blurb: meta.blurb || "",
      endpoints,
    });
  }

  groups.sort((a, b) => a.title.localeCompare(b.title));

  return {
    baseUrl: `${env.app.publicApiUrl}${env.app.apiPrefix}`,
    apiPrefix: env.app.apiPrefix,
    endpointCount,
    groupCount: groups.length,
    groups,
  };
}

/**
 * The catalogue, built once per process.
 *
 * `baseUrl` overrides the configured origin. Callers that have a request pass
 * the origin it actually arrived on, because PUBLIC_API_URL is a deployment
 * setting and a wrong one is invisible until an integrator imports the
 * collection and every request 404s. The origin a request came in on reaches
 * the API by construction.
 */
function catalogue({ baseUrl } = {}) {
  if (!cached) cached = build();
  return baseUrl ? { ...cached, baseUrl } : cached;
}

/** The origin this request arrived on, honouring the proxy when we trust it. */
function baseUrlFromRequest(req) {
  const host = req && typeof req.get === "function" ? req.get("host") : null;
  if (!host) return null;
  return `${req.protocol}://${host}${env.app.apiPrefix}`;
}

/**
 * A Postman v2.1 collection covering every documented endpoint, with the
 * key and base URL as collection variables so importing it and pasting one
 * key is the whole setup.
 */
function postmanCollection({ organizationName, baseUrl } = {}) {
  const data = catalogue({ baseUrl });

  const toItem = (endpoint) => {
    const segments = endpoint.path.split("/").filter(Boolean);
    return {
      name: `${endpoint.method} ${endpoint.path}`,
      request: {
        method: endpoint.method,
        header: [
          { key: "x-api-key", value: "{{apiKey}}", type: "text" },
          ...(["POST", "PATCH", "PUT"].includes(endpoint.method)
            ? [{ key: "Content-Type", value: "application/json", type: "text" }]
            : []),
        ],
        ...(["POST", "PATCH", "PUT"].includes(endpoint.method)
          ? { body: { mode: "raw", raw: "{\n  \n}", options: { raw: { language: "json" } } } }
          : {}),
        url: {
          raw: `{{baseUrl}}${endpoint.path}`,
          host: ["{{baseUrl}}"],
          path: segments,
          ...(endpoint.method === "GET" && !endpoint.path.includes(":")
            ? { query: [{ key: "limit", value: "20", disabled: true }, { key: "page", value: "1", disabled: true }] }
            : {}),
        },
        description: `${endpoint.description}\n\nRequired permission${endpoint.scopes.length === 1 ? "" : "s"}: ${
          endpoint.scopes.length ? `${endpoint.scopes.join(endpoint.scopeMode === "any" ? " OR " : " AND ")}` : "none beyond a valid key"
        }`,
      },
      response: [],
    };
  };

  return {
    info: {
      _postman_id: "chefotech-hrms-api",
      name: `ChefoTech HRMS API${organizationName ? ` — ${organizationName}` : ""}`,
      description:
        "Every endpoint of the ChefoTech HRMS API.\n\n" +
        "Setup: open the collection's Variables tab, paste your API key into `apiKey`, and check that `baseUrl` matches your server. " +
        "Create a key in the web app under Settings → API & webhooks. A key only carries the permissions it was given, " +
        "so a request can fail with 403 even though the key is valid — grant the scope named in each request's description.",
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    variable: [
      { key: "baseUrl", value: data.baseUrl, type: "string" },
      { key: "apiKey", value: "", type: "string" },
    ],
    item: data.groups.map((group) => ({
      name: group.title,
      description: group.blurb,
      item: group.endpoints.map(toItem),
    })),
  };
}

module.exports = { catalogue, postmanCollection, baseUrlFromRequest };
