"use strict";

/**
 * Reads the shape of a Zod schema that already guards a real endpoint.
 *
 * The form registry needs to know, for every input in the product, what it is
 * called, what type it holds, whether it is required and what values it will
 * accept. All of that is already stated — precisely, and in the only place
 * that actually decides the answer — by the Zod schema the route validates
 * against. Describing those fields a second time by hand would create two
 * sources of truth that drift the moment someone adds a field, and the drift
 * would be invisible: the AI would confidently fill an input the API rejects,
 * or a help icon would sit beside a field that no longer exists.
 *
 * So structure is derived here, never authored. Only the *meaning* of a field
 * (why it matters, what a good value looks like) is written by a human, and
 * formRegistry binds the two together with a test that fails when a schema
 * gains a field nobody explained.
 *
 * The semantic types below (`time`, `date`, `colour`, `reference`) are
 * recovered from the regexes in core/validation/common.js. A plain "string"
 * would be technically true and practically useless — the AI needs to know it
 * must emit "09:00" and not "9am", and the UI needs to know to render a time
 * picker rather than a text box.
 */

const TIME_PATTERN = String(/^([01]\d|2[0-3]):[0-5]\d$/);
const DATE_PATTERN = String(/^\d{4}-\d{2}-\d{2}$/);
const COLOUR_PATTERN = String(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);

/**
 * Strip the wrappers that describe how a value may be absent, keeping track
 * of what each one permits. `.optional()`, `.nullable()`, `.default()` and
 * the ZodEffects produced by `.refine()` / `.transform()` all wrap the type
 * that actually carries the field's shape.
 */
function unwrap(type) {
  const meta = { optional: false, nullable: false, hasDefault: false, defaultValue: undefined };
  let current = type;

  // Bounded rather than an open loop: a schema built with a cyclic reference
  // would otherwise hang the process at require time, taking the whole API
  // down at boot instead of failing one field.
  for (let depth = 0; depth < 20 && current && current._def; depth += 1) {
    const name = current._def.typeName;

    if (name === "ZodOptional") {
      meta.optional = true;
      current = current._def.innerType;
    } else if (name === "ZodNullable") {
      meta.nullable = true;
      current = current._def.innerType;
    } else if (name === "ZodDefault") {
      meta.hasDefault = true;
      // Zod stores the default as a thunk, so it is a function here.
      try {
        meta.defaultValue = current._def.defaultValue();
      } catch {
        meta.defaultValue = undefined;
      }
      current = current._def.innerType;
    } else if (name === "ZodEffects") {
      // `.refine()` and `.transform()` — objectId() and dateString() are both
      // built this way, so failing to unwrap here would type them as unknown.
      current = current._def.schema;
    } else {
      break;
    }
  }

  return { inner: current, meta };
}

/** Pull the .min() / .max() / .regex() checks off a string or number. */
function readChecks(def) {
  const out = {};
  for (const check of def.checks || []) {
    if (check.kind === "min") out.min = check.value;
    else if (check.kind === "max") out.max = check.value;
    else if (check.kind === "int") out.integer = true;
    else if (check.kind === "email") out.email = true;
    else if (check.kind === "regex") out.pattern = String(check.regex);
  }
  return out;
}

/**
 * The field's type as the UI and the AI need to understand it, which is a
 * more specific question than "what Zod class is this".
 */
function classify(inner, checks) {
  const name = inner._def.typeName;

  if (name === "ZodString") {
    if (checks.email) return "email";
    if (checks.pattern === TIME_PATTERN) return "time";
    if (checks.pattern === DATE_PATTERN) return "date";
    if (checks.pattern === COLOUR_PATTERN) return "colour";
    // An unconstrained string behind a .refine() is, in this codebase, always
    // objectId() — a pointer at another record rather than free text.
    if (!checks.pattern && checks.min === undefined && checks.max === undefined) return "reference";
    return "string";
  }

  if (name === "ZodNumber") return checks.integer ? "integer" : "number";
  if (name === "ZodBoolean") return "boolean";
  if (name === "ZodEnum" || name === "ZodNativeEnum") return "enum";
  if (name === "ZodArray") return "array";
  if (name === "ZodObject") return "object";
  if (name === "ZodUnion") return "union";
  return "unknown";
}

/**
 * Describe one field. Nested objects and arrays-of-objects recurse, because a
 * leave rule's allocation.mode is as much an input a person has to understand
 * as a top-level name is.
 */
function describeField(name, type, depth) {
  const { inner, meta } = unwrap(type);
  if (!inner || !inner._def) return { name, type: "unknown", required: false, nullable: false };

  const checks = readChecks(inner._def);
  const kind = classify(inner, checks);

  const field = {
    name,
    type: kind,
    // A field with a default is not something the user must supply.
    required: !meta.optional && !meta.hasDefault,
    nullable: meta.nullable,
  };

  if (meta.hasDefault && meta.defaultValue !== undefined) field.default = meta.defaultValue;
  if (checks.min !== undefined) field.min = checks.min;
  if (checks.max !== undefined) field.max = checks.max;
  if (checks.pattern && kind === "string") field.pattern = checks.pattern;
  if (kind === "enum") field.options = inner._def.values ? [...inner._def.values] : [];

  // Depth-limited so a deeply nested schema cannot produce an unbounded tree
  // that the prompt then has to carry.
  if (depth < 3) {
    if (kind === "object") {
      field.fields = introspect(inner, depth + 1);
    } else if (kind === "array") {
      const { inner: element } = unwrap(inner._def.type);
      if (element && element._def) {
        if (element._def.typeName === "ZodObject") {
          field.itemType = "object";
          field.itemFields = introspect(element, depth + 1);
        } else {
          const elementChecks = readChecks(element._def);
          field.itemType = classify(element, elementChecks);
          if (field.itemType === "enum") field.options = element._def.values ? [...element._def.values] : [];
        }
      }
    }
  }

  return field;
}

/** Every field of a ZodObject, in declaration order. */
function introspect(schema, depth = 0) {
  const { inner } = unwrap(schema);
  if (!inner || !inner._def || inner._def.typeName !== "ZodObject") return [];
  return Object.entries(inner.shape).map(([name, type]) => describeField(name, type, depth));
}

/** Just the top-level keys — used to check a registry covers its schema. */
function fieldNames(schema) {
  const { inner } = unwrap(schema);
  if (!inner || !inner._def || inner._def.typeName !== "ZodObject") return [];
  return Object.keys(inner.shape);
}

function toProperty(field) {
  switch (field.type) {
    case "integer":
      return { type: "integer" };
    case "number":
      return { type: "number" };
    case "boolean":
      return { type: "boolean" };
    case "enum":
      return { type: "string", enum: field.options || [] };
    case "time":
      return { type: "string", description: "24-hour time as HH:mm, e.g. 09:00" };
    case "date":
      return { type: "string", description: "Calendar date as YYYY-MM-DD" };
    case "colour":
      return { type: "string", description: "Hex colour, e.g. #4F46E5" };
    case "object":
      return toResponseSchema(field.fields || []);
    case "array":
      return {
        type: "array",
        items:
          field.itemType === "object"
            ? toResponseSchema(field.itemFields || [])
            : toProperty({ type: field.itemType || "string", options: field.options }),
      };
    default:
      return { type: "string" };
  }
}

/**
 * Turn described fields into the JSON schema Gemini is constrained to when it
 * drafts a record. Deriving it means the model is structurally incapable of
 * proposing a field the endpoint would reject.
 *
 * `reference` fields are deliberately dropped rather than typed as strings: a
 * field holding another record's id is the one thing a language model cannot
 * possibly know and will most confidently hallucinate. Those are resolved by
 * name against the real collection after the draft comes back, or left for
 * the person to pick.
 */
function toResponseSchema(fields) {
  const properties = {};
  const required = [];

  for (const field of fields) {
    if (field.type === "reference" || field.type === "unknown" || field.type === "union") continue;
    properties[field.name] = toProperty(field);
    if (field.required) required.push(field.name);
  }

  const schema = { type: "object", properties };
  if (required.length) schema.required = required;
  return schema;
}

module.exports = { introspect, fieldNames, toResponseSchema, unwrap };
