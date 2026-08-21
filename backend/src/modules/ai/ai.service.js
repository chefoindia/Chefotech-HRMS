"use strict";

const AiCredential = require("./aiCredential.model");
const secretBox = require("../../core/security/secretBox");
const gemini = require("./geminiClient");
const { AppError } = require("../../core/errors/AppError");
const { logger } = require("../../config/logger");

const AVAILABLE_MODELS = [
  { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash — fast, low cost (recommended)" },
  { value: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash-Lite — fastest, lowest cost" },
  { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro — slower, better on complex requests" },
];

/** Status for the settings screen. Never includes the key itself. */
async function status() {
  const record = await AiCredential.findOne({ provider: "gemini" }).lean();
  if (!record) return { configured: false, model: null, keySuffix: null, isEnabled: false };

  return {
    configured: true,
    isEnabled: record.isEnabled,
    model: record.model,
    keySuffix: record.keySuffix,
    lastVerifiedAt: record.lastVerifiedAt,
    lastError: record.lastError,
    usage: record.usage,
    updatedAt: record.updatedAt,
  };
}

/**
 * Save (or replace) the organization's key.
 *
 * The key is verified with one real call before it is stored, so "saved"
 * always means "known to work" — an admin who fat-fingers a key finds out
 * immediately, at the point they can still see what they just pasted, rather
 * than the first time an employee tries to use a feature that depends on it.
 */
async function saveKey({ apiKey, model }, userId) {
  const trimmed = String(apiKey || "").trim();
  if (trimmed.length < 20) {
    throw AppError.badRequest("That does not look like a Gemini API key.");
  }
  const chosenModel = model && AVAILABLE_MODELS.some((m) => m.value === model)
    ? model
    : AVAILABLE_MODELS[0].value;

  const verified = await gemini.verifyKey({ apiKey: trimmed, model: chosenModel }).catch((err) => {
    // Re-thrown as-is: AI_INVALID_KEY / AI_TIMEOUT / AI_UNAVAILABLE already
    // carry a message written for an admin reading a settings screen.
    throw err;
  });
  if (!verified) {
    throw new AppError("AI_INVALID_KEY", { message: "Gemini accepted the key but gave an unexpected reply. Please try again." });
  }

  const encrypted = secretBox.encrypt(trimmed);

  await AiCredential.findOneAndUpdate(
    { provider: "gemini" },
    {
      provider: "gemini",
      model: chosenModel,
      ...encrypted,
      keySuffix: trimmed.slice(-4),
      isEnabled: true,
      lastVerifiedAt: new Date(),
      lastError: null,
      updatedBy: userId || null,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return status();
}

async function setEnabled(isEnabled) {
  const record = await AiCredential.findOneAndUpdate(
    { provider: "gemini" },
    { isEnabled: Boolean(isEnabled) },
    { new: true }
  );
  if (!record) throw AppError.notFound("AI configuration");
  return status();
}

async function removeKey() {
  await AiCredential.deleteOne({ provider: "gemini" });
}

/**
 * The decrypted key and model for internal use only. Every caller in this
 * codebase is a service function that immediately sends it to Google — this
 * must never be reachable from a route handler that could echo it back.
 */
async function resolveCredential() {
  const record = await AiCredential.findOne({ provider: "gemini" });
  if (!record || !record.isEnabled) {
    throw new AppError("AI_NOT_CONFIGURED", {
      message: "AI features are not turned on for your organization. An administrator can set this up in Settings → AI.",
    });
  }

  let apiKey;
  try {
    apiKey = secretBox.decrypt(record);
  } catch (err) {
    logger.error({ err }, "Failed to decrypt stored Gemini key");
    throw new AppError("AI_NOT_CONFIGURED", {
      message: "The stored AI key could not be read. Please re-enter it in Settings → AI.",
    });
  }

  return { apiKey, model: record.model, record };
}

/**
 * Run a prompt through Gemini using the org's stored key, and record usage.
 *
 * Usage is tracked (a count and a timestamp, never the prompt or response
 * content) so an admin can see the feature is actually being used, without
 * this becoming a second place that logs what employees typed.
 */
async function run({ prompt, systemInstruction, responseSchema, temperature }) {
  const { apiKey, model, record } = await resolveCredential();

  try {
    const result = await gemini.generateContent({ apiKey, model, prompt, systemInstruction, responseSchema, temperature });
    AiCredential.updateOne(
      { _id: record._id },
      { $inc: { "usage.requestCount": 1 }, $set: { "usage.lastUsedAt": new Date(), lastError: null } }
    ).catch((err) => logger.warn({ err }, "Failed to record AI usage"));
    return result;
  } catch (err) {
    if (err instanceof AppError) {
      AiCredential.updateOne({ _id: record._id }, { $set: { lastError: err.message } }).catch(() => undefined);
    }
    throw err;
  }
}

module.exports = {
  AVAILABLE_MODELS,
  status,
  saveKey,
  setEnabled,
  removeKey,
  run,
};
