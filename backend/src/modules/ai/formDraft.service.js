"use strict";

const ai = require("./ai.service");
const { PRODUCT_PRIMER } = require("./aiAssistant.service");
const registry = require("../../core/forms/formRegistry");
const { AppError } = require("../../core/errors/AppError");
const { logger } = require("../../config/logger");

/**
 * "Fill this in for me" — for any form in the registry, not one hand-wired
 * endpoint per entity.
 *
 * The existing draftLeavePolicy proved the idea and showed its limit: its
 * JSON schema is typed out by hand, so the feature exists for exactly one of
 * the product's forms and every new one needs a developer. Here the schema is
 * generated from the same Zod definition the endpoint validates against, so
 * adding an entity to the registry is the entire cost of giving it AI fill.
 *
 * Three properties this deliberately keeps:
 *
 *   Nothing is saved. This returns values for the form to display; the person
 *   looks at them in the real inputs and presses Save themselves, through the
 *   ordinary permission-checked endpoint. The AI route is gated on the same
 *   permission as saving, so drafting is never a way around access control.
 *
 *   A value the schema would reject never reaches the form. The model is
 *   fallible in ways that matter here — "9am" where "09:00" is required,
 *   "alternating" where the enum says "alternate" — so every field is checked
 *   against the real validator individually and the bad ones are dropped and
 *   reported, rather than one wrong field failing the whole draft.
 *
 *   Nothing is invented for fields that point at other records. Those are
 *   stripped from the model's schema upstream, in formRegistry.
 */

/** The per-field slice of a Zod object, for validating one value at a time. */
function shapeOf(schema) {
  const inner = schema && schema._def && schema._def.typeName === "ZodObject" ? schema : null;
  return inner ? inner.shape : {};
}

/**
 * Check each proposed value against its own field validator.
 *
 * Validating the object as a whole would be simpler and much worse: one bad
 * time string would throw away eleven good fields, and the person would get
 * an empty form and no idea why.
 */
function keepValidFields(entitySchema, values) {
  const shape = shapeOf(entitySchema);
  const accepted = {};
  const rejected = [];

  for (const [name, value] of Object.entries(values || {})) {
    const fieldSchema = shape[name];

    if (!fieldSchema) {
      // The response schema is generated from this same object, so this only
      // happens if the model ignored it outright.
      rejected.push({ field: name, reason: "not a field on this form" });
      continue;
    }

    const result = fieldSchema.safeParse(value);
    if (result.success) {
      accepted[name] = result.data;
    } else {
      rejected.push({
        field: name,
        reason: result.error.issues[0]?.message || "not a valid value for this field",
        proposed: value,
      });
    }
  }

  return { accepted, rejected };
}

/** Required fields the draft did not manage to fill — the form still needs them. */
function missingRequired(fields, accepted) {
  return fields
    .filter((f) => f.required && f.type !== "reference" && accepted[f.name] === undefined)
    .map((f) => f.name);
}

/** Required fields that hold another record's id — always for a human to pick. */
function needsSelection(fields) {
  return fields.filter((f) => f.type === "reference").map((f) => f.name);
}

function buildPrompt({ entity, fieldNotes, instruction, current }) {
  const currentText =
    current && Object.keys(current).length
      ? `\n\nThe form already has these values. Keep anything that is already correct, and only change what the instruction asks for:\n${JSON.stringify(current, null, 2)}`
      : "";

  return `An HR administrator is filling in the "${entity.label}" form and described what they want in their own words:

"${instruction}"

The fields on this form:
${fieldNotes.join("\n")}${currentText}

Fill in every field you can justify from what they said. Where they did not specify something, choose the value a typical Indian workplace would use, but do not invent specifics they would obviously want to decide themselves — a name they gave you is theirs, a name they did not is yours to propose plainly.`;
}

const SYSTEM_SUFFIX = `

You are now filling in a form on the administrator's behalf. The values you
return are shown to them in the real form for review before anything is saved,
so propose a complete, usable record rather than a cautious half-filled one.

Rules:
1. Respect the stated type of every field exactly. A time is "HH:mm" in 24-hour
   form ("09:00", never "9am"). A date is "YYYY-MM-DD". A field listing allowed
   values accepts only one of those values, spelled exactly as listed.
2. Stay inside any stated range. A value outside it will be discarded.
3. Explain your choices in two or three sentences, in the words an HR
   administrator would use — especially anything you decided for them.`;

/**
 * Draft one record for one registered form.
 *
 * `permissions` is checked here as well as at the route, because this is the
 * function that decides which form's shape gets handed to the model.
 */
async function draft(entityKey, { instruction, current }, { permissions }) {
  const described = registry.draftSchemaFor(entityKey);
  if (!described) throw AppError.notFound("Form");

  const { entity, responseSchema, fieldNotes } = described;

  if (entity.permission && !permissions.includes(entity.permission)) {
    throw AppError.forbidden(`You do not have permission to create a ${entity.label.toLowerCase()}.`);
  }

  const { json } = await ai.run({
    prompt: buildPrompt({ entity, fieldNotes, instruction, current }),
    systemInstruction: `${PRODUCT_PRIMER}${SYSTEM_SUFFIX}${entity.guidance ? `\n\nAbout this form specifically:\n${entity.guidance}` : ""}`,
    responseSchema: {
      type: "object",
      properties: {
        explanation: {
          type: "string",
          description: "Two or three sentences: what you set, and why — especially anything you chose for them.",
        },
        values: responseSchema,
      },
      required: ["explanation", "values"],
    },
    temperature: 0.2,
  });

  // A model that returns nothing usable is a failed draft, not an empty form
  // quietly presented as a successful one.
  if (!json || typeof json !== "object") {
    throw AppError.badRequest("The assistant could not produce a draft for this form. Try rephrasing.");
  }

  const fields = registry.describeEntity(entityKey).fields;
  const { accepted, rejected } = keepValidFields(entity.schema, json.values);

  if (rejected.length) {
    logger.warn({ entity: entityKey, rejected }, "AI form draft: dropped values the schema refused");
  }

  return {
    entity: entityKey,
    label: entity.label,
    values: accepted,
    explanation: typeof json.explanation === "string" ? json.explanation.trim() : "",
    rejected,
    missingRequired: missingRequired(fields, accepted),
    needsSelection: needsSelection(fields),
  };
}

module.exports = { draft, keepValidFields, missingRequired };
