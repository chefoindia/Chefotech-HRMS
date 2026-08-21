"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

/**
 * Render URLs, per store.
 *
 * These exist because of a bug that reported success and produced a broken
 * image: `publicImageUrl` took a bare provider id and assumed Google Drive, so
 * a file written to local disk came back as
 * `lh3.googleusercontent.com/d/<a local uuid>`. The upload was fine, the
 * database row was fine, and the logo silently failed to load — nothing in the
 * system registered a problem, because from the API's point of view there
 * wasn't one.
 *
 * The URL a file renders at is therefore treated as a real output worth
 * asserting on, for every store, rather than as string formatting.
 */

const CLOUD = { CLOUDINARY_CLOUD_NAME: "testcloud", CLOUDINARY_API_KEY: "k", CLOUDINARY_API_SECRET: "s" };

/** Load the module under a specific environment; config is read at require time. */
function loadStorage(overrides = {}) {
  const saved = {};
  for (const [key, value] of Object.entries(overrides)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  // Only the modules that read config at require time. Evicting the Mongoose
  // model as well would re-register the schema and throw OverwriteModelError.
  const RELOAD = ["config\\env.js", "storage.service.js", "cloudinary.provider.js"];
  for (const key of Object.keys(require.cache)) {
    const normalised = key.split("/").join("\\");
    if (RELOAD.some((name) => normalised.endsWith(name))) delete require.cache[key];
  }
  const mod = require("../../src/core/storage/storage.service");
  return {
    storage: mod,
    restore() {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}

const file = (over = {}) => ({
  _id: "651f1a2b3c4d5e6f70819200",
  providerId: "provider-id",
  provider: "drive",
  visibility: "public",
  mimeType: "image/png",
  originalName: "logo.png",
  size: 1024,
  category: "branding",
  ...over,
});

test("image render URLs", async (t) => {
  await t.test("a public Drive image renders through lh3, with the size hint", () => {
    const { storage, restore } = loadStorage();
    const url = storage.publicImageUrl(file({ provider: "drive", providerId: "1AbCdEf" }), {
      width: 800,
    });
    assert.equal(url, "https://lh3.googleusercontent.com/d/1AbCdEf=w800");
    restore();
  });

  await t.test("a locally stored image never claims to be on Google", () => {
    // The original bug, stated as an assertion.
    const { storage, restore } = loadStorage();
    const url = storage.publicImageUrl(
      file({ provider: "local", providerId: "f44b9071-f1cd-4094-9a02-e42501d7cad6" }),
      { width: 800 }
    );
    assert.ok(!url.includes("googleusercontent"), `local file leaked a Drive URL: ${url}`);
    assert.ok(url.includes("/files/651f1a2b3c4d5e6f70819200/content"), url);
    // Absolute, or an <img> in the browser resolves it against the frontend
    // origin and an email cannot resolve it at all.
    assert.ok(/^https?:\/\//.test(url), `file URL must be absolute: ${url}`);
    restore();
  });

  await t.test("a private Drive file is proxied, not exposed on a public host", () => {
    const { storage, restore } = loadStorage();
    const url = storage.publicImageUrl(file({ provider: "drive", visibility: "private" }));
    assert.ok(!url.includes("googleusercontent"), url);
    assert.ok(url.includes("/content"), url);
    restore();
  });

  await t.test("a Cloudinary image renders from the CDN with format and quality negotiation", () => {
    const { storage, restore } = loadStorage(CLOUD);
    const url = storage.publicImageUrl(
      file({ provider: "cloudinary", providerId: "chefotech-hrms/org-1/branding/logo" }),
      { width: 400 }
    );
    assert.ok(url.startsWith("https://res.cloudinary.com/testcloud/image/upload/"), url);
    assert.ok(url.includes("f_auto"), "should negotiate format");
    assert.ok(url.includes("q_auto"), "should negotiate quality");
    assert.ok(url.includes("w_400"), "should request the size the layout uses");
    assert.ok(url.endsWith("chefotech-hrms/org-1/branding/logo"), url);
    restore();
  });

  await t.test("a width is never upscaled past the source", () => {
    const { storage, restore } = loadStorage(CLOUD);
    const url = storage.publicImageUrl(file({ provider: "cloudinary" }), { width: 4000 });
    assert.ok(url.includes("c_limit"), `expected c_limit, got ${url}`);
    restore();
  });

  await t.test("a Cloudinary image still renders if the credentials are later removed", () => {
    const { storage, restore } = loadStorage({
      CLOUDINARY_CLOUD_NAME: "",
      CLOUDINARY_API_KEY: "",
      CLOUDINARY_API_SECRET: "",
    });
    const url = storage.publicImageUrl(file({ provider: "cloudinary" }), { width: 400 });
    assert.ok(url, "should fall back rather than returning nothing");
    assert.ok(url.includes("/content"), url);
    restore();
  });

  await t.test("a bare provider id is refused instead of guessing a host", () => {
    const { storage, restore } = loadStorage();
    // The old calling convention. Returning null surfaces a missing image;
    // guessing produces one that is confidently wrong.
    assert.equal(storage.publicImageUrl("some-provider-id", { width: 200 }), null);
    restore();
  });

  await t.test("a missing file does not throw at a render site", () => {
    const { storage, restore } = loadStorage();
    assert.equal(storage.publicImageUrl(null), null);
    assert.equal(storage.publicImageUrl(file({ providerId: null })), null);
    restore();
  });
});

test("upload routing", async (t) => {
  await t.test("Cloudinary takes images but refuses SVG", () => {
    const cloudinary = require("../../src/core/storage/cloudinary.provider");
    assert.equal(cloudinary.accepts("image/png"), true);
    assert.equal(cloudinary.accepts("image/jpeg"), true);
    assert.equal(cloudinary.accepts("image/webp"), true);
    // SVG can carry a <script>; it stays on the proxied path where it is
    // served as a download rather than as same-origin markup.
    assert.equal(cloudinary.accepts("image/svg+xml"), false);
    assert.equal(cloudinary.accepts("application/pdf"), false);
    assert.equal(cloudinary.accepts(undefined), false);
  });

  await t.test("a tenant's images are namespaced so they can be purged as a unit", () => {
    const { storage, restore } = loadStorage(CLOUD);
    const cloudinary = require("../../src/core/storage/cloudinary.provider");
    const url = cloudinary.renderUrl("chefotech-hrms/org-42/avatar/x", { width: 100 });
    assert.ok(url.includes("/org-42/"), url);
    assert.ok(storage.CATEGORY_RULES.avatar, "avatar remains a known category");
    restore();
  });
});

test("only one place builds file URLs", async (t) => {
  const fs = require("node:fs");
  const path = require("node:path");

  function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (entry.name.endsWith(".js")) out.push(full);
    }
    return out;
  }

  await t.test("no module hand-rolls a files path of its own", () => {
    // This bug has now happened twice. The first time a caller assumed Drive
    // and produced a dead lh3 URL; the second time a module branched on
    // provider itself and fell back to a hard-coded RELATIVE path, so the
    // browser resolved it against the frontend origin and the tenant's logo
    // silently failed to load. Both were a second URL builder living outside
    // the storage layer, so that is what this forbids.
    const SRC = path.resolve(__dirname, "../../src");
    const ALLOWED = path.join("core", "storage");
    const offenders = [];

    for (const file of walk(SRC)) {
      const relative = path.relative(SRC, file);
      if (relative.includes(ALLOWED)) continue;
      const code = fs.readFileSync(file, "utf8");
      for (const match of code.matchAll(/["'`][^"'`]*\/files\/[^"'`]*content[^"'`]*["'`]/g)) {
        offenders.push({ file: relative, snippet: match[0] });
      }
      for (const match of code.matchAll(/lh3\.googleusercontent\.com/g)) {
        offenders.push({ file: relative, snippet: "hard-coded lh3 host" });
      }
    }

    assert.deepEqual(
      offenders,
      [],
      `file URLs must come from storage.publicImageUrl / toPublicShape:
${JSON.stringify(offenders, null, 2)}`
    );
  });
});
