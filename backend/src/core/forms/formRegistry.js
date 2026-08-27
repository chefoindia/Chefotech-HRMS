"use strict";

const { introspect, fieldNames, toResponseSchema } = require("./schemaIntrospect");
const { ShiftSchema, WeeklyOffSchema, PatternSchema } = require("../../modules/shifts/shift.schema");
const HELP = require("./formHelp");

/**
 * Every form in the product, described once.
 *
 * Two things in this platform were being solved separately and badly. An
 * administrator looking at an input often cannot tell what it will do — the
 * consequence of a grace period or an accrual mode shows up weeks later in
 * someone's pay, not at the moment of typing. And the assistant could point
 * at a screen but never fill it in, because the only inputs it knew about
 * were the twenty-five hand-listed steps of eight guided tours.
 *
 * Both are the same missing thing: a machine-readable description of what
 * every input means. This is it.
 *
 * The split matters. **Structure** — names, types, bounds, enum values,
 * whether a field is required — is read out of the Zod schema that already
 * guards the endpoint, never restated here. **Meaning** — why a field exists
 * and what a good value looks like — is written by a human in formHelp.js,
 * because no schema can express it. formRegistry.test.js asserts the two
 * halves still line up, so a field added to a schema fails the build here
 * rather than reaching a customer as an unexplained box, and a help entry for
 * a field that no longer exists is caught rather than sitting there rotting.
 *
 * One entity per form the user can actually open. `permission` is the
 * permission needed to SAVE the thing — the AI draft endpoint checks exactly
 * that, so asking the assistant to fill a form is never a way around the
 * access control on the form itself.
 */

const ENTITIES = [
  {
    key: "shift",
    label: "Shift",
    plural: "Shifts",
    schema: ShiftSchema,
    route: "/app/settings/shifts",
    permission: "shift.manage",
    // Read by the assistant before it drafts. Anything an experienced HR
    // administrator would know from context but a model would not.
    guidance:
      "A shift's end time earlier than its start time means an overnight shift; the platform handles that automatically and produces one attendance record for the night the shift began. Codes are short, uppercase and stable (GEN, NIGHT, MORN). Indian workplaces most often run a 09:00-18:00 general shift with a 60-minute break.",
  },
  {
    key: "weekly_off",
    label: "Week off pattern",
    plural: "Week off patterns",
    schema: WeeklyOffSchema,
    route: "/app/settings/week-off",
    permission: "shift.manage",
    guidance:
      "days must contain all seven entries, day 0 = Sunday through day 6 = Saturday. Use type 'alternate' with offOccurrences to express rules like '2nd and 4th Saturday off' — offOccurrences [2,4] means the 2nd and 4th such weekday of the month. A six-day week with alternate Saturdays is the most common Indian factory pattern.",
  },
  {
    key: "shift_pattern",
    label: "Shift pattern",
    plural: "Shift patterns",
    schema: PatternSchema,
    route: "/app/settings/shift-patterns",
    permission: "shift.manage",
    guidance:
      "A 'weekly' pattern repeats every calendar week and uses days[]. A 'rotating' pattern repeats every N days regardless of weekday and uses cycle[] plus anchorDate, which is the real date that sits at position 0. Leave a position's shiftId null to make it a rest day.",
  },
];

const BY_KEY = Object.fromEntries(ENTITIES.map((e) => [e.key, e]));

/**
 * Attach the human-authored help to the derived structure.
 *
 * Nested fields are addressed by dotted path (`allocation.mode`), the same
 * string the frontend form writes to, so a renamed field shows up as missing
 * help rather than help silently attached to the wrong input.
 */
function decorate(fields, helpMap, prefix = "") {
  return fields.map((field) => {
    const path = prefix ? `${prefix}.${field.name}` : field.name;
    const help = helpMap[path] || null;

    const decorated = { ...field, path };
    if (help) decorated.help = help;

    if (field.fields) decorated.fields = decorate(field.fields, helpMap, path);
    if (field.itemFields) decorated.itemFields = decorate(field.itemFields, helpMap, path);

    return decorated;
  });
}

/** Every field of one entity, structure and meaning together. */
function describeEntity(key) {
  const entity = BY_KEY[key];
  if (!entity) return null;

  const helpMap = HELP[key] || {};
  return {
    key: entity.key,
    label: entity.label,
    plural: entity.plural,
    route: entity.route,
    permission: entity.permission,
    guidance: entity.guidance,
    fields: decorate(introspect(entity.schema), helpMap),
  };
}

/** Only the entities this caller could actually save, described in full. */
function describeAll(permissions) {
  return ENTITIES.filter((e) => !e.permission || permissions.includes(e.permission)).map((e) =>
    describeEntity(e.key)
  );
}

/** The catalogue line the assistant sees — one entity per line, no fields. */
function describeForPrompt(permissions) {
  return ENTITIES.filter((e) => !e.permission || permissions.includes(e.permission))
    .map((e) => `- ${e.key}: ${e.label} — ${e.plural} are managed at ${e.route}.`)
    .join("\n");
}

/**
 * The JSON schema Gemini is constrained to when drafting this entity, plus
 * the field notes that tell it what each one means. The schema comes straight
 * from the Zod definition, so the model cannot propose a field the endpoint
 * would reject.
 */
function draftSchemaFor(key) {
  const entity = BY_KEY[key];
  if (!entity) return null;

  const fields = introspect(entity.schema);
  return {
    entity,
    responseSchema: toResponseSchema(fields),
    fieldNotes: fieldNotesFor(key, fields),
  };
}

function fieldNotesFor(key, fields, prefix = "") {
  const helpMap = HELP[key] || {};
  const lines = [];

  for (const field of fields) {
    const path = prefix ? `${prefix}.${field.name}` : field.name;

    if (field.type === "reference") continue; // never offered to the model

    const bits = [`- ${path} (${field.type}${field.required ? ", required" : ""})`];
    if (field.options && field.options.length) bits.push(`one of: ${field.options.join(", ")}.`);
    if (field.min !== undefined || field.max !== undefined) {
      bits.push(`range ${field.min ?? "any"}-${field.max ?? "any"}.`);
    }
    if (helpMap[path] && helpMap[path].why) bits.push(helpMap[path].why);
    lines.push(bits.join(" "));

    if (field.fields) lines.push(...fieldNotesFor(key, field.fields, path));
    if (field.itemFields) lines.push(...fieldNotesFor(key, field.itemFields, path));
  }

  return lines;
}

module.exports = {
  ENTITIES,
  BY_KEY,
  describeEntity,
  describeAll,
  describeForPrompt,
  draftSchemaFor,
  fieldNames,
};
