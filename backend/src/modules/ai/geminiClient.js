"use strict";

const { AppError } = require("../../core/errors/AppError");
const { logger } = require("../../config/logger");

/**
 * A thin wrapper over Gemini's REST API — no SDK dependency for the same
 * reason the Cloudinary provider has none: the surface used here is one
 * endpoint, and a dependency that pulls in its own retry/transport stack is
 * not worth it for that.
 *
 * Every call is a single, stateless `generateContent` request. There is no
 * server-side conversation state — each request carries whatever context the
 * caller needs, and the response is parsed into plain text or JSON. This
 * keeps the whole integration auditable: nothing here can accumulate hidden
 * state across a tenant's requests.
 */

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
/** Real network calls fail eventually; a stuck request must not hang a request thread. */
const TIMEOUT_MS = 25_000;

/**
 * `responseSchema` constrains Gemini to return JSON matching a shape we
 * define, which is what lets an AI-drafted leave policy be reviewed as
 * structured fields instead of parsed out of free text. Passing one turns on
 * `responseMimeType: application/json` automatically.
 */
/**
 * Whether a 4xx from Gemini is actually about the credential.
 *
 * Google reports a bad key as 400 INVALID_ARGUMENT with a structured reason of
 * API_KEY_INVALID, which is the same HTTP status it uses for a request we
 * built wrong. The reason — or failing that the message — is the only thing
 * that separates them.
 */
function mentionsApiKey(payload) {
  const error = payload && payload.error;
  if (!error) return false;

  const reasons = (error.details || []).map((d) => String(d.reason || "").toUpperCase());
  if (reasons.some((reason) => reason.includes("API_KEY"))) return true;

  const text = `${error.status || ""} ${error.message || ""}`.toUpperCase();
  return text.includes("API_KEY") || text.includes("API KEY");
}

async function generateContent({
  apiKey,
  model = "gemini-2.5-flash",
  prompt,
  contents,
  systemInstruction,
  responseSchema,
  functionDeclarations,
  temperature = 0.4,
}) {
  if (!apiKey) throw new AppError("AI_NOT_CONFIGURED", { message: "No Gemini API key is configured." });

  const url = `${API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    // `contents` (a multi-turn history) takes precedence over a single `prompt`
    // string — the chatbot passes a history, every other caller passes a prompt.
    contents: contents || [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      maxOutputTokens: 2048,
      // Function calling and JSON-schema-constrained output are mutually
      // exclusive in one request — a function-calling turn's "structured
      // output" is the function call itself.
      ...(responseSchema && !functionDeclarations
        ? { responseMimeType: "application/json", responseSchema }
        : {}),
    },
  };
  if (systemInstruction) {
    body.systemInstruction = { role: "system", parts: [{ text: systemInstruction }] };
  }
  if (functionDeclarations && functionDeclarations.length) {
    body.tools = [{ functionDeclarations }];
    // ANY (rather than AUTO) is deliberately not used here — the chatbot must
    // be able to just talk, not be forced to call something on every turn.
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new AppError("AI_TIMEOUT", { message: "The AI did not respond in time. Please try again." });
    }
    logger.error({ err }, "Gemini request failed to send");
    throw new AppError("AI_UNAVAILABLE", { message: "Could not reach the AI service." });
  } finally {
    clearTimeout(timer);
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const message = payload?.error?.message || `Gemini returned HTTP ${response.status}`;
    // 400 with an API-key reason is the caller's key being wrong, not our bug —
    // surfaced distinctly so the settings screen can say "check your key"
    // rather than a generic failure.
    //
    // The reason has to actually be read, though. Gemini also returns 400
    // INVALID_ARGUMENT for a malformed request — an empty function-calling
    // enum, a bad response schema — and treating every 400 as a bad key sent
    // an administrator off to re-enter a credential that was never the
    // problem. Worse, saveKey() aborts its model-candidate loop the moment it
    // sees AI_INVALID_KEY, so one malformed probe request could make a
    // perfectly good key unsaveable.
    const isKeyProblem = response.status === 403 || (response.status === 400 && mentionsApiKey(payload));
    // 404 here is specifically "this model id does not exist for this key" —
    // Google retires and renames model ids on its own schedule (this app has
    // already been caught out twice by a hardcoded name going stale), so this
    // gets its own code rather than falling into the generic upstream bucket:
    // it is the one failure `resolveWorkingModel` below can recover from by
    // trying a different model, instead of giving up.
    const isMissingModel = response.status === 404;
    throw new AppError(
      isKeyProblem ? "AI_INVALID_KEY" : isMissingModel ? "AI_MODEL_NOT_FOUND" : "AI_UPSTREAM_ERROR",
      {
        message: isKeyProblem
          ? "Gemini rejected this API key. Check that it was copied correctly and has not been revoked."
          : `The AI service returned an error: ${message}`,
        status: isKeyProblem ? 422 : isMissingModel ? 422 : 502,
      }
    );
  }

  const candidate = payload?.candidates?.[0];
  const finishReason = candidate?.finishReason;
  const parts = candidate?.content?.parts || [];
  const text = parts.map((part) => part.text || "").join("");
  const functionCalls = parts
    .filter((part) => part.functionCall)
    .map((part) => ({ name: part.functionCall.name, args: part.functionCall.args || {} }));

  if (!text && !functionCalls.length) {
    throw new AppError("AI_EMPTY_RESPONSE", {
      message:
        finishReason === "SAFETY"
          ? "The AI declined to answer that — try rephrasing."
          : "The AI returned an empty response. Please try again.",
    });
  }

  if (responseSchema && !functionDeclarations) {
    try {
      return { text, json: JSON.parse(text), functionCalls: [] };
    } catch {
      throw new AppError("AI_MALFORMED_RESPONSE", {
        message: "The AI's response could not be parsed. Please try again.",
      });
    }
  }

  return { text, json: null, functionCalls };
}

/** A cheap, deterministic call used only to confirm a newly-pasted key actually works. */
async function verifyKey({ apiKey, model }) {
  const { text } = await generateContent({
    apiKey,
    model,
    prompt: 'Reply with exactly one word: "ok".',
    temperature: 0,
  });
  return text.toLowerCase().includes("ok");
}

/**
 * The real, current list of models this specific key can use — asking Google
 * directly instead of assuming a hardcoded id is still valid. Model ids get
 * retired and renamed on Google's own schedule, independent of any release
 * here, so this is the only way to pick a model that is actually guaranteed
 * to work for this key right now.
 */
async function listModels({ apiKey }) {
  if (!apiKey) throw new AppError("AI_NOT_CONFIGURED", { message: "No Gemini API key is configured." });

  const url = `${API_BASE}/models?key=${encodeURIComponent(apiKey)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new AppError("AI_TIMEOUT", { message: "The AI did not respond in time. Please try again." });
    }
    logger.error({ err }, "Gemini model list request failed to send");
    throw new AppError("AI_UNAVAILABLE", { message: "Could not reach the AI service." });
  } finally {
    clearTimeout(timer);
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const isKeyProblem = response.status === 400 || response.status === 403;
    throw new AppError(isKeyProblem ? "AI_INVALID_KEY" : "AI_UPSTREAM_ERROR", {
      message: isKeyProblem
        ? "Gemini rejected this API key. Check that it was copied correctly and has not been revoked."
        : `The AI service returned an error: ${payload?.error?.message || `HTTP ${response.status}`}`,
      status: isKeyProblem ? 422 : 502,
    });
  }

  return (payload?.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => ({ id: String(m.name || "").replace(/^models\//, ""), displayName: m.displayName || m.name }));
}

module.exports = { generateContent, verifyKey, listModels, mentionsApiKey };
