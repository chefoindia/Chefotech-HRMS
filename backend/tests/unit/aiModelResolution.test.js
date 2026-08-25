"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { mock } = require("node:test");

const mongoose = require("mongoose");
const { startDatabase, stopDatabase, clearDatabase } = require("../helpers/db");
const tenant = require("../../src/core/tenancy/tenantContext");
const gemini = require("../../src/modules/ai/geminiClient");
const ai = require("../../src/modules/ai/ai.service");
const AiCredential = require("../../src/modules/ai/aiCredential.model");

const ORG_ID = new mongoose.Types.ObjectId();

/**
 * Google's model catalog (`models.list`) and what a key can actually
 * generate content with are two different things — a model can be listed
 * and still be rejected at generation time ("no longer available to new
 * users" is exactly this). The first version of this fix trusted the
 * catalog listing directly and shipped that same bug into production the
 * same day. These tests exist specifically to keep that from happening
 * again: `candidateModels` only narrows the field, and `saveKey` must prove
 * each candidate with a real call before trusting it.
 */

const A_LIST = [
  { id: "gemini-3.6-flash", displayName: "Gemini 3.6 Flash" },
  { id: "gemini-3.1-pro-preview", displayName: "Gemini 3.1 Pro Preview" },
  { id: "gemini-3.6-flash-lite", displayName: "Gemini 3.6 Flash-Lite" },
  { id: "text-embedding-004", displayName: "Text Embedding" },
  { id: "gemini-3.1-flash-image", displayName: "Gemini 3.1 Flash Image" },
];

test.before(async () => {
  await startDatabase();
});

test.after(async () => {
  await stopDatabase();
});

test.beforeEach(async () => {
  await clearDatabase();
});

test.afterEach(() => mock.restoreAll());

// ── candidateModels: ordering and filtering only, no claim of "this works" ──

test("orders flash-like models first for the 'fast' preference", async () => {
  mock.method(gemini, "listModels", async () => A_LIST);
  const candidates = await ai.candidateModels("fake-key", "fast");
  assert.equal(candidates[0], "gemini-3.6-flash");
});

test("orders pro-like models first for the 'capable' preference", async () => {
  mock.method(gemini, "listModels", async () => A_LIST);
  const candidates = await ai.candidateModels("fake-key", "capable");
  assert.equal(candidates[0], "gemini-3.1-pro-preview");
});

test("never includes an image, embedding, audio or live-only variant", async () => {
  mock.method(gemini, "listModels", async () => A_LIST);
  const candidates = await ai.candidateModels("fake-key", "fast");
  assert.ok(!candidates.includes("text-embedding-004"));
  assert.ok(!candidates.includes("gemini-3.1-flash-image"));
});

test("throws AI_MODEL_NOT_FOUND rather than returning an empty list", async () => {
  mock.method(gemini, "listModels", async () => [{ id: "text-embedding-004" }]);
  await assert.rejects(() => ai.candidateModels("fake-key", "fast"), (err) => err.code === "AI_MODEL_NOT_FOUND");
});

test("tries an already-saved literal model id first", async () => {
  mock.method(gemini, "listModels", async () => A_LIST);
  const candidates = await ai.candidateModels("fake-key", "gemini-3.6-flash-lite");
  assert.equal(candidates[0], "gemini-3.6-flash-lite");
});

// ── saveKey: the actual regression — a listed model that generation rejects ──

test("skips a model that is listed but rejected at generation time, and saves the next one that actually works", async () => {
  mock.method(gemini, "listModels", async () => [
    { id: "gemini-2.5-flash" }, // exists in the catalog, but...
    { id: "gemini-3.6-flash" },
  ]);
  mock.method(gemini, "verifyKey", async ({ model }) => {
    if (model === "gemini-2.5-flash") {
      const { AppError } = require("../../src/core/errors/AppError");
      throw new AppError("AI_MODEL_NOT_FOUND", { message: "no longer available to new users" });
    }
    return model === "gemini-3.6-flash";
  });

  await tenant.runWithTenant(ORG_ID, async () => {
    const result = await ai.saveKey({ apiKey: "AIzaFakeTestKeyForVerification1234567890", model: "fast" }, new mongoose.Types.ObjectId());
    assert.equal(result.model, "gemini-3.6-flash", "must fall through to the model that actually verified");
  });
});

test("stops immediately on a bad key instead of retrying every candidate", async () => {
  mock.method(gemini, "listModels", async () => A_LIST);
  let verifyCalls = 0;
  mock.method(gemini, "verifyKey", async () => {
    verifyCalls += 1;
    const { AppError } = require("../../src/core/errors/AppError");
    throw new AppError("AI_INVALID_KEY", { message: "Gemini rejected this API key." });
  });

  await tenant.runWithTenant(ORG_ID, async () => {
    await assert.rejects(
      () => ai.saveKey({ apiKey: "AIzaFakeTestKeyForVerification1234567890", model: "fast" }, new mongoose.Types.ObjectId()),
      (err) => err.code === "AI_INVALID_KEY"
    );
  });
  assert.equal(verifyCalls, 1, "a bad key fails identically for every model — trying a second one wastes a real call for no new information");
});

test("nothing is stored when every candidate fails", async () => {
  mock.method(gemini, "listModels", async () => A_LIST);
  mock.method(gemini, "verifyKey", async () => {
    const { AppError } = require("../../src/core/errors/AppError");
    throw new AppError("AI_MODEL_NOT_FOUND", { message: "not available" });
  });

  await tenant.runWithTenant(ORG_ID, async () => {
    await assert.rejects(() => ai.saveKey({ apiKey: "AIzaFakeTestKeyForVerification1234567890", model: "fast" }, new mongoose.Types.ObjectId()));
    const stored = await AiCredential.findOne({ provider: "gemini" }).lean();
    assert.equal(stored, null);
  });
});
