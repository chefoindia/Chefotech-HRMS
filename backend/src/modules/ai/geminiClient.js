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
async function generateContent({ apiKey, model = "gemini-2.0-flash", prompt, systemInstruction, responseSchema, temperature = 0.4 }) {
  if (!apiKey) throw new AppError("AI_NOT_CONFIGURED", { message: "No Gemini API key is configured." });

  const url = `${API_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      maxOutputTokens: 2048,
      ...(responseSchema
        ? { responseMimeType: "application/json", responseSchema }
        : {}),
    },
  };
  if (systemInstruction) {
    body.systemInstruction = { role: "system", parts: [{ text: systemInstruction }] };
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
    const isKeyProblem = response.status === 400 || response.status === 403;
    throw new AppError(isKeyProblem ? "AI_INVALID_KEY" : "AI_UPSTREAM_ERROR", {
      message: isKeyProblem
        ? "Gemini rejected this API key. Check that it was copied correctly and has not been revoked."
        : `The AI service returned an error: ${message}`,
      status: isKeyProblem ? 422 : 502,
    });
  }

  const candidate = payload?.candidates?.[0];
  const finishReason = candidate?.finishReason;
  const text = candidate?.content?.parts?.map((part) => part.text || "").join("") || "";

  if (!text) {
    throw new AppError("AI_EMPTY_RESPONSE", {
      message:
        finishReason === "SAFETY"
          ? "The AI declined to answer that — try rephrasing."
          : "The AI returned an empty response. Please try again.",
    });
  }

  if (responseSchema) {
    try {
      return { text, json: JSON.parse(text) };
    } catch {
      throw new AppError("AI_MALFORMED_RESPONSE", {
        message: "The AI's response could not be parsed. Please try again.",
      });
    }
  }

  return { text, json: null };
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

module.exports = { generateContent, verifyKey };
