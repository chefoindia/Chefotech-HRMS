"use strict";

const ai = require("./ai.service");
const { PRODUCT_PRIMER } = require("./aiAssistant.service");
const registry = require("./actionRegistry");
const organizationService = require("../organizations/organization.service");
const { logger } = require("../../config/logger");

/**
 * The setup guide / "mother" chatbot.
 *
 * It is a thin layer over three things that already exist and are already
 * trustworthy: the product primer (what is actually true about this
 * platform), the action registry (the only routes and tour ids it is allowed
 * to reference), and the guided-tour engine (which does the actual
 * navigating, highlighting and field-filling in the browser). This service's
 * only job is to pick the right action from the registry and hand it to the
 * frontend — it never performs the action itself, and it never writes a
 * value to anything. The frontend's tour engine writes a value only when the
 * user, looking at the real field, confirms it.
 *
 * There is no server-side conversation memory, for the same reason
 * geminiClient has none: the caller sends the transcript it already has on
 * screen, and every request is otherwise stateless.
 */

const MAX_HISTORY_TURNS = 16;

const FUNCTION_DECLARATIONS_TEMPLATE = (tourIds, allIds) => [
  {
    name: "navigate_to",
    description:
      "Send the user to a real screen in the product. Use for anything that does not have an interactive walkthrough, or when the user just wants to get there.",
    parameters: {
      type: "OBJECT",
      properties: {
        actionId: { type: "STRING", enum: allIds, description: "One id from the action list in the system instructions." },
      },
      required: ["actionId"],
    },
  },
  {
    name: "start_tour",
    description:
      "Launch a real, interactive, step-by-step walkthrough that opens the right screen, highlights the exact field, and asks for each value in turn. Prefer this over navigate_to whenever the action has one.",
    parameters: {
      type: "OBJECT",
      properties: {
        actionId: { type: "STRING", enum: tourIds, description: "One tour id from the action list." },
      },
      required: ["actionId"],
    },
  },
  {
    name: "suggest_field_values",
    description:
      "Pre-fill a suggested value for one or more fields of the tour just started with start_tour, based on something the user already told you. The user still confirms every value themselves before it is saved — this only saves them typing. Only include a field the user actually gave you information about.",
    parameters: {
      type: "OBJECT",
      properties: {
        actionId: { type: "STRING", enum: tourIds, description: "The same tour id passed to start_tour." },
        values: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              field: { type: "STRING", description: "The exact field name from the action list." },
              value: { type: "STRING", description: "The value as plain text, e.g. an HH:mm time, a number, or an option value." },
            },
            required: ["field", "value"],
          },
        },
      },
      required: ["actionId", "values"],
    },
  },
];

function buildSystemInstruction({ permissions, onboardingText }) {
  return `${PRODUCT_PRIMER}

You are also the setup guide built into the product: an always-available companion an administrator can ask for help finding or changing anything, and who can walk a brand-new organization through setup from a blank slate, one screen at a time, so nothing required gets missed. HR staff who are not administrators may also talk to you about screens they have access to — the tools below already reflect what the person you are talking to is allowed to see.

Only ever reference an id from this exact list — never invent one, never guess a route or a field name:
${registry.describeForPrompt(permissions)}

Current setup progress for this organization:
${onboardingText}

How to behave:
1. If the user names a concrete thing they want to see or change ("office timings", "change my logo", "add a leave policy", "who approves leave"), pick the single best matching action. Call start_tour if it has a walkthrough (a much better experience — it opens the exact form and highlights the exact field); otherwise call navigate_to. State in one short sentence what you are doing.
2. If the user asks to be guided through setup from scratch, or asks what is left to do, use the setup progress above: name the next required step in one short sentence, then call start_tour (or navigate_to if it has no walkthrough) for that step only. Wait for them to finish before suggesting the next one — never dump the whole checklist in one message.
3. If they describe a value while asking for something ("call the general shift 9 to 6", "grace period should be 10 minutes"), still call start_tour for the right walkthrough, and also call suggest_field_values with your best reading of the value(s), using the exact field names listed for that action. Never guess a value they did not give you.
4. If nothing on the list matches, or it is a "how does X work" question rather than a "take me there" request, just answer in 2-4 sentences the way you always would — do not call a tool for that turn.
5. Keep replies short. This is a chat bubble docked in the corner of the screen, not a document.`;
}

function toGeminiRole(role) {
  return role === "assistant" ? "model" : "user";
}

/**
 * Turn Gemini's function calls into the actions the frontend performs.
 *
 * Separated from chat() so it can be tested against the shapes the model
 * actually returns — a bare object where an array was declared, calls arriving
 * in an unexpected order, an actionId for a tour the caller may not open —
 * without needing a live API key to reproduce any of them.
 */
function interpretCalls(calls, permissions) {
  const actions = [];

  /**
   * Navigation and tours first, prefills second.
   *
   * Gemini may emit several function calls in one turn and the order is not
   * guaranteed, so a single pass that expects start_tour to arrive before its
   * suggest_field_values silently dropped the values whenever the model
   * happened to emit them the other way round — the user was then asked to
   * retype something they had already said in the message that started the
   * tour. Splitting the passes removes the dependency on an order the API
   * never promised.
   */
  for (const call of calls) {
    const args = call.args || {};

    if (call.name === "navigate_to") {
      const action = registry.ACTIONS_BY_ID[args.actionId];
      if (!action || (action.permission && !permissions.includes(action.permission))) continue;
      actions.push({ type: "navigate", route: action.route, title: action.title });
    } else if (call.name === "start_tour") {
      const action = registry.ACTIONS_BY_ID[args.actionId];
      if (!action || action.kind !== "tour" || (action.permission && !permissions.includes(action.permission))) continue;
      actions.push({ type: "start_tour", tourId: action.id, title: action.title, prefill: {} });
    } else if (call.name !== "suggest_field_values") {
      logger.warn({ name: call.name }, "Chatbot: unknown function call from Gemini, ignored");
    }
  }

  for (const call of calls) {
    if (call.name !== "suggest_field_values") continue;
    const args = call.args || {};

    // Only ever the tour this call actually names. The previous fallback to
    // "whichever tour was started most recently" validated the field names
    // against one action while writing them into another, so a prefill could
    // land in a tour whose permission had not been checked for those fields.
    const target = actions.find((a) => a.type === "start_tour" && a.tourId === args.actionId);
    if (!target) continue;

    const tourAction = registry.ACTIONS_BY_ID[args.actionId];
    const knownFields = new Set((tourAction?.fields || []).map((f) => f.field));

    // Gemini returns a bare object instead of a single-element array often
    // enough to matter, and `for...of` over one throws — which surfaced as a
    // 500 on a chat message rather than a missing prefill.
    const values = Array.isArray(args.values) ? args.values : args.values ? [args.values] : [];

    for (const entry of values) {
      if (entry && entry.field && knownFields.has(entry.field)) {
        target.prefill[entry.field] = entry.value;
      }
    }
  }

  return actions;
}

async function chat({ message, history, route }, { permissions }) {
  const onboarding = await organizationService.getOnboarding().catch(() => null);
  const onboardingText = registry.describeOnboardingForPrompt(onboarding);

  const systemInstruction = buildSystemInstruction({ permissions, onboardingText });

  const allIds = registry.visibleActions(permissions).map((a) => a.id);
  const tourIds = registry.visibleTourIds(permissions);

  // Gemini rejects a declaration whose enum is empty with a 400, and a caller
  // holding none of the registry's permissions — a platform user, say —
  // produces exactly that. Sending it turned an ordinary chat message into an
  // upstream error that then read on the settings screen as a bad API key.
  // Dropping the tool instead leaves the assistant able to answer questions,
  // which is all it could have done for that person anyway.
  const functionDeclarations = FUNCTION_DECLARATIONS_TEMPLATE(tourIds, allIds).filter(
    (declaration) =>
      !Object.values(declaration.parameters.properties).some(
        (property) => Array.isArray(property.enum) && property.enum.length === 0
      )
  );

  const trimmedHistory = (history || []).slice(-MAX_HISTORY_TURNS);
  const contents = [
    ...trimmedHistory.map((turn) => ({ role: toGeminiRole(turn.role), parts: [{ text: turn.text }] })),
    {
      role: "user",
      parts: [{ text: route ? `[They are currently on the "${route}" screen]\n${message}` : message }],
    },
  ];

  const result = await ai.run({ contents, systemInstruction, functionDeclarations, temperature: 0.3 });

  const actions = interpretCalls(result.functionCalls || [], permissions);

  return {
    reply: result.text ? result.text.trim() : actions.length ? "" : "I'm not sure — could you rephrase that?",
    actions,
  };
}

module.exports = { chat, interpretCalls };
