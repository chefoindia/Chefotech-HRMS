"use strict";

const AiCredential = require("./aiCredential.model");
const secretBox = require("../../core/security/secretBox");
const gemini = require("./geminiClient");
const { AppError } = require("../../core/errors/AppError");
const { logger } = require("../../config/logger");

// Google retires and renames Gemini model ids on its own schedule, entirely
// independent of any release here — a hardcoded id in this file has already
// gone stale twice in one week (2.0 shut down, then 2.5-flash stopped being
// offered to new keys). So this is not a list of model ids any more, just a
// speed/capability PREFERENCE — `resolveWorkingModel` below turns it into
// whichever real, currently-offered model id best matches, by asking the key
// itself what it can use, every time one is saved. Nothing here is ever sent
// to Google directly as a model id.
const AVAILABLE_MODELS = [
  { value: "fast", label: "Fastest, lowest cost (recommended)" },
  { value: "capable", label: "Slower, better on complex requests" },
];

/**
 * Candidate models worth actually trying for this key, best guess first —
 * NOT a decision. `models.list` returns Google's whole catalog for the
 * account, but a model appearing there does not mean this key can generate
 * content with it: "no longer available to new users" is enforced at
 * generation time, not reflected in the listing. Trusting the list directly
 * is exactly the mistake that shipped here once already, so every candidate
 * this returns still has to be proven with a real call — see the loops in
 * `saveKey` and `run` below.
 *
 * `preference` is "fast" or "capable" (or a literal model id already stored
 * on an existing credential, from before this became preference-based —
 * tried first if present, so an existing save is not disturbed for no
 * reason). Excludes model variants this platform never sends the right kind
 * of request for (image/audio/video generation, embeddings, live/realtime).
 * Capped at 5 — this is a list of real network calls about to happen, not a
 * free filter.
 */
async function candidateModels(apiKey, preference) {
  const models = await gemini.listModels({ apiKey });
  const ids = models.map((m) => m.id).filter((id) => !/(embed|image|vision|audio|tts|live|video)/i.test(id));

  if (!ids.length) {
    throw new AppError("AI_MODEL_NOT_FOUND", {
      message: "This Gemini account has no text model available to use yet.",
    });
  }

  const flash = ids.filter((id) => /flash/i.test(id) && !/lite/i.test(id));
  const pro = ids.filter((id) => /pro/i.test(id));
  const rest = ids.filter((id) => !flash.includes(id) && !pro.includes(id));

  let ordered = preference === "capable" ? [...pro, ...flash, ...rest] : [...flash, ...pro, ...rest];

  const literal = preference && preference !== "fast" && preference !== "capable" ? preference : null;
  if (literal && ids.includes(literal)) {
    ordered = [literal, ...ordered.filter((id) => id !== literal)];
  }

  return [...new Set(ordered)].slice(0, 5);
}

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

  const candidates = await candidateModels(trimmed, model);

  let chosenModel = null;
  let lastErr = null;
  for (const candidate of candidates) {
    try {
      const verified = await gemini.verifyKey({ apiKey: trimmed, model: candidate });
      if (verified) {
        chosenModel = candidate;
        break;
      }
      lastErr = new AppError("AI_INVALID_KEY", {
        message: "Gemini accepted the key but gave an unexpected reply. Please try again.",
      });
    } catch (err) {
      lastErr = err;
      // A bad/revoked key fails identically against every model — stop
      // immediately instead of burning four more real calls to learn the
      // same thing four more times. Anything else (this particular model
      // not available, rate limited, upstream hiccup) is worth trying the
      // next candidate for.
      if (err instanceof AppError && err.code === "AI_INVALID_KEY") throw err;
    }
  }

  if (!chosenModel) {
    throw lastErr || new AppError("AI_MODEL_NOT_FOUND", { message: "No available model could be verified for this key." });
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
async function run({ prompt, contents, systemInstruction, responseSchema, functionDeclarations, temperature }) {
  const { apiKey, model, record } = await resolveCredential();

  const attempt = (useModel) =>
    gemini.generateContent({
      apiKey,
      model: useModel,
      prompt,
      contents,
      systemInstruction,
      responseSchema,
      functionDeclarations,
      temperature,
    });

  try {
    let result;
    let usedModel = model;
    try {
      result = await attempt(model);
    } catch (err) {
      // The model saved with this key stopped being offered sometime after
      // it was verified — try the same request against other candidates
      // this key can plausibly use, rather than surfacing an error an admin
      // can only fix by re-entering the key they already correctly entered.
      // Each candidate is proven with the real request itself, same
      // reasoning as the loop in saveKey: Google's model catalog listing
      // does not guarantee generation actually works against a given id.
      if (err instanceof AppError && err.code === "AI_MODEL_NOT_FOUND") {
        const candidates = (await candidateModels(apiKey, "fast")).filter((id) => id !== model);
        let healed = false;
        for (const candidate of candidates) {
          try {
            result = await attempt(candidate);
            usedModel = candidate;
            healed = true;
            break;
          } catch (retryErr) {
            if (!(retryErr instanceof AppError && retryErr.code === "AI_MODEL_NOT_FOUND")) throw retryErr;
          }
        }
        if (!healed) throw err;
      } else {
        throw err;
      }
    }

    const usageUpdate = { $inc: { "usage.requestCount": 1 }, $set: { "usage.lastUsedAt": new Date(), lastError: null } };
    if (usedModel !== model) usageUpdate.$set.model = usedModel;
    AiCredential.updateOne({ _id: record._id }, usageUpdate).catch((err) =>
      logger.warn({ err }, "Failed to record AI usage")
    );
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
  candidateModels,
  status,
  saveKey,
  setEnabled,
  removeKey,
  run,
};
