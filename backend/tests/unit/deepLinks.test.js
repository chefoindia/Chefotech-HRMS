"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { TOURS } = require("../../src/modules/help/tours");
const { INTENTS } = require("../../src/modules/help/helpIntents");
const { TEMPLATES } = require("../../src/modules/notifications/notificationTemplates");
const { ONBOARDING_STEPS } = require("../../src/modules/organizations/onboardingSteps");
const { LANDING_ROUTES } = require("../../src/modules/auth/auth.service");

/**
 * Deep links are the one place the backend hard-codes knowledge of the
 * frontend. Nothing else in the system fails if a route is renamed — the tour
 * engine simply navigates to a 404, the notification's "View" button dead-ends,
 * and neither shows up in any log. This suite is the check that a route rename
 * on the frontend side breaks a test rather than breaking a customer's
 * onboarding walkthrough.
 *
 * It reads the sibling frontend project directly. If that directory is absent
 * (backend deployed on its own, CI running only the API image) the suite skips
 * rather than failing — the assertion is about consistency between the two, and
 * with only one of them present there is nothing to be inconsistent about.
 */

const FRONTEND = path.resolve(__dirname, "../../../frontend");
const APP_DIR = path.join(FRONTEND, "app");
const frontendPresent = fs.existsSync(APP_DIR);

/** Every file under a directory, recursively. */
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

/**
 * The set of routes the Next.js app router actually serves, derived from the
 * location of every page file. Route groups `(name)` contribute nothing to the
 * URL; dynamic segments `[id]` become the placeholder `*`.
 */
function routesFromPages() {
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

/**
 * Reduce a hard-coded link to the shape `routesFromPages` produces: drop the
 * query string, and collapse `{{placeholders}}` to the dynamic marker.
 */
function normalise(url) {
  const withoutQuery = String(url).split("?")[0].replace(/\/+$/, "") || "/";
  return withoutQuery
    .split("/")
    .map((segment) => (/\{\{.*\}\}/.test(segment) ? "*" : segment))
    .join("/");
}

/** Does this link land on a page the app serves? */
function isServed(url, routes) {
  const target = normalise(url);
  if (routes.has(target)) return true;
  // A link may point at a prefix the app resolves through a dynamic segment,
  // e.g. `/app/employees/` after a create redirects to `/app/employees/[id]`.
  const asDynamic = target.replace(/\/$/, "") + "/*";
  return routes.has(asDynamic);
}

/** Every hard-coded app link in the backend, with where it came from. */
function collectLinks() {
  const links = [];

  for (const tour of TOURS) {
    for (const step of tour.steps) {
      if (step.route) links.push({ url: step.route, source: `tour ${tour.id} → step ${step.id} route` });
      if (step.completeRoute) {
        links.push({ url: step.completeRoute, source: `tour ${tour.id} → step ${step.id} completeRoute` });
      }
    }
  }

  for (const intent of INTENTS) {
    if (intent.route) links.push({ url: intent.route, source: `help intent ${intent.id}` });
  }

  // The setup checklist. Missed by the first version of this suite, which
  // enumerated files by hand — and a new administrator's very first click
  // landed on a 404 as a result. Sources are now listed exhaustively below.
  for (const step of ONBOARDING_STEPS) {
    if (step.route) links.push({ url: step.route, source: `onboarding step ${step.key}` });
  }

  for (const [audience, route] of Object.entries(LANDING_ROUTES)) {
    links.push({ url: route, source: `sign-in landing route for ${audience}` });
  }

  for (const [key, template] of Object.entries(TEMPLATES)) {
    // A wholly dynamic actionUrl is resolved at send time by the module that
    // raises the event; there is no literal route here to verify.
    if (template.actionUrl && !/^\{\{[\w.]+\}\}$/.test(template.actionUrl.trim())) {
      links.push({ url: template.actionUrl, source: `notification template ${key}` });
    }
  }

  return links.filter((link) => link.url.startsWith("/"));
}

test("deep links", { skip: frontendPresent ? false : "frontend project not present" }, async (t) => {
  const routes = routesFromPages();

  await t.test("the frontend exposes the routes we are about to check against", () => {
    // Guards the guard: a broken walk would make every assertion below vacuous.
    assert.ok(routes.size > 20, `expected a substantial route table, found ${routes.size}`);
    assert.ok(routes.has("/app/employees"), "employees list should be a discovered route");
  });

  await t.test("every route a tour navigates to exists", () => {
    const broken = collectLinks()
      .filter((link) => link.source.startsWith("tour"))
      .filter((link) => !isServed(link.url, routes));
    assert.deepEqual(broken, [], `tours navigate to routes the app does not serve:\n${JSON.stringify(broken, null, 2)}`);
  });

  await t.test("every sign-in landing route exists", () => {
    const broken = collectLinks()
      .filter((link) => link.source.startsWith("sign-in landing"))
      .filter((link) => !isServed(link.url, routes));
    assert.deepEqual(
      broken,
      [],
      `people are signed in and dropped onto routes that do not exist:
${JSON.stringify(broken, null, 2)}`
    );
  });

  await t.test("every onboarding step opens a screen that exists", () => {
    const broken = collectLinks()
      .filter((link) => link.source.startsWith("onboarding"))
      .filter((link) => !isServed(link.url, routes));
    assert.deepEqual(
      broken,
      [],
      `the setup checklist links to routes the app does not serve:
${JSON.stringify(broken, null, 2)}`
    );
  });

  await t.test("no backend file hard-codes an app route this suite does not check", () => {
    // The guard's own blind spot, made visible. Any /app, /me or /onboarding
    // literal in a backend source file must come from a module this suite
    // enumerates, or it goes unchecked exactly like the onboarding steps did.
    const CHECKED = [
      path.join("modules", "help", "tours.js"),
      path.join("modules", "help", "helpIntents.js"),
      path.join("modules", "notifications", "notificationTemplates.js"),
      path.join("modules", "workflow", "workflow.service.js"),
      path.join("modules", "organizations", "onboardingSteps.js"),
      path.join("modules", "auth", "auth.service.js"),
    ];
    const SRC = path.resolve(__dirname, "../../src");
    const unchecked = [];

    for (const file of walk(SRC)) {
      if (!file.endsWith(".js")) continue;
      const relative = path.relative(SRC, file);
      if (CHECKED.some((known) => relative.endsWith(known))) continue;
      const code = fs.readFileSync(file, "utf8");
      const hits = [...code.matchAll(/["'`](\/(?:app|me|onboarding)\/[a-zA-Z0-9/_{}.:*-]*)["'`]/g)];
      for (const hit of hits) {
        // An Express route registration is a server path that happens to
        // start with /me — `router.get("/me/balances")` is an API endpoint,
        // not a link to a page. Only strings that are not the first argument
        // of a route registration are frontend links.
        const before = code.slice(Math.max(0, hit.index - 60), hit.index);
        if (/router\s*\.\s*(get|post|put|patch|delete|use|all)\s*\(\s*$/.test(before)) continue;
        unchecked.push({ file: relative, route: hit[1] });
      }
    }

    assert.deepEqual(
      unchecked,
      [],
      `backend files hard-code app routes outside this suite's coverage — add them to collectLinks():
${JSON.stringify(unchecked, null, 2)}`
    );
  });

  await t.test("every route the help assistant sends people to exists", () => {
    const broken = collectLinks()
      .filter((link) => link.source.startsWith("help intent"))
      .filter((link) => !isServed(link.url, routes));
    assert.deepEqual(broken, [], `help answers link to routes the app does not serve:\n${JSON.stringify(broken, null, 2)}`);
  });

  await t.test("every notification action link exists", () => {
    const broken = collectLinks()
      .filter((link) => link.source.startsWith("notification"))
      .filter((link) => !isServed(link.url, routes));
    assert.deepEqual(broken, [], `notifications link to routes the app does not serve:\n${JSON.stringify(broken, null, 2)}`);
  });

  await t.test("every element a tour drives is present in the UI", () => {
    // The tour engine waits for its target and then gives up; a renamed
    // data-tour attribute strands the user mid-walkthrough with no error.
    const present = new Set();
    const sources = [
      ...walk(APP_DIR),
      ...(fs.existsSync(path.join(FRONTEND, "components"))
        ? walk(path.join(FRONTEND, "components"))
        : []),
    ].filter((file) => /\.(tsx|jsx)$/.test(file));

    for (const file of sources) {
      const code = fs.readFileSync(file, "utf8");
      // Literal attributes, conditional attributes, and the tour ids that pages
      // hand to shared components as props (addTour="…", tour: "…").
      for (const m of code.matchAll(/data-tour=(?:"([a-z0-9-]+)"|\{[^}]*\})/g)) {
        if (m[1]) present.add(m[1]);
      }
      for (const m of code.matchAll(/data-tour=\{[^}]*\}/g)) {
        for (const s of m[0].matchAll(/"([a-z0-9-]+)"/g)) present.add(s[1]);
      }
      for (const m of code.matchAll(/(?:addTour|formTour|saveTour|completeTour|tour)\s*[:=]\s*"([a-z0-9-]+)"/g)) {
        present.add(m[1]);
      }
    }

    const missing = [];
    for (const tour of TOURS) {
      for (const step of tour.steps) {
        for (const key of ["target", "completeTarget"]) {
          const selector = step[key];
          if (!selector) continue;
          // Deliberately permissive about the name: a selector this pattern
          // cannot parse must be reported, not quietly skipped, or a typo in
          // the attribute name would slip through the very check meant to
          // catch it.
          const match = /^\[data-tour="([^"]+)"\]$/.exec(selector);
          if (!match) {
            missing.push({ tour: tour.id, step: step.id, [key]: selector, reason: "not a data-tour selector" });
            continue;
          }
          if (!present.has(match[1])) {
            missing.push({ tour: tour.id, step: step.id, [key]: match[1] });
          }
        }
      }
    }

    assert.deepEqual(missing, [], `tours target elements that do not exist:\n${JSON.stringify(missing, null, 2)}`);
  });
});
