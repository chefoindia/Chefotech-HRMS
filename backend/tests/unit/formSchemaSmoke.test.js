"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const registry = require("../../src/core/forms/formRegistry");

/**
 * Every registered schema, put through a record built from its own description.
 *
 * The form registry claims to know what each endpoint accepts. This checks the
 * claim end to end: take the introspected field list, synthesise a value for
 * each field that satisfies what it says about itself, and hand the result to
 * the real validator. If the description is right, the schema accepts it.
 *
 * The failure this exists for is not a wrong type. It is a schema that throws
 * while validating — a helper referenced inside a `.refine()` that is no
 * longer in scope. That is invisible at import, invisible to a type checker,
 * and invisible to every test that happens not to send the one field carrying
 * the callback. Moving the schemas into their own modules did exactly that to
 * the workflow step's `condition`, and 274 passing tests said nothing, because
 * none of them had ever submitted a step with a condition on it.
 *
 * Synthesising from the description rather than hand-writing fixtures is the
 * point: a field added to a schema is covered here the day it appears, with
 * nobody remembering to add it.
 */

/**
 * Fields whose real constraint lives in a `.refine()` and so cannot be read
 * off the schema at all.
 *
 * Introspection sees `timezone` as an ordinary string; the callback that
 * demands a real IANA name is opaque to it. Rather than loosen the assertion
 * for every string in the product, the few genuinely special names are listed
 * here. A new one shows up as a failure naming the exact field, which is the
 * right amount of friction — an unreadable constraint is worth knowing about.
 */
const SEMANTIC_VALUES = {
  timezone: "Asia/Kolkata",
};

/** A value that should satisfy everything `field` says about itself. */
function synthesise(field) {
  if (field.name && SEMANTIC_VALUES[field.name] !== undefined) return SEMANTIC_VALUES[field.name];

  switch (field.type) {
    case "enum":
      return field.options && field.options.length ? field.options[0] : undefined;

    case "boolean":
      return true;

    case "integer":
    case "number": {
      // Land inside the stated range; a lot of these are 1-based.
      const low = field.min ?? 1;
      const high = field.max ?? low + 1;
      const value = Math.min(Math.max(low, 1), high);
      return field.type === "integer" ? Math.round(value) : value;
    }

    case "time":
      return "09:00";
    case "date":
      return "2026-01-15";
    case "colour":
      return "#4F46E5";
    case "email":
      return "person@example.com";

    // A real, parseable id — objectId() checks it rather than just its shape.
    case "reference":
      return new mongoose.Types.ObjectId().toString();

    case "string": {
      const min = field.min ?? 1;
      const max = field.max ?? Math.max(min, 8);
      // Lowercase and hyphen-free so it also satisfies slug-ish patterns.
      return "sample".slice(0, max).padEnd(Math.min(min, max), "x") || "x";
    }

    case "object":
      return buildRecord(field.fields || []);

    case "array": {
      // Respect a fixed size — WeeklyOffSchema refuses anything but seven.
      const count = field.exact ?? field.min ?? 1;
      const item =
        field.itemType === "object"
          ? () => buildRecord(field.itemFields || [])
          : () => synthesise({ type: field.itemType || "string", options: field.options });
      return Array.from({ length: Math.max(count, 1) }, item);
    }

    default:
      return undefined;
  }
}

/** A record carrying every field the schema describes. */
function buildRecord(fields) {
  const record = {};
  for (const field of fields) {
    const value = synthesise(field);
    if (value !== undefined) record[field.name] = value;
  }
  return record;
}

/** Only what the schema insists on, to check nothing extra is demanded. */
function buildMinimalRecord(fields) {
  const record = {};
  for (const field of fields) {
    if (!field.required) continue;
    const value = synthesise(field);
    if (value !== undefined) record[field.name] = value;
  }
  return record;
}

test("registered form schemas", async (t) => {
  for (const entity of registry.ENTITIES) {
    await t.test(`${entity.key} validates a fully populated record`, () => {
      const described = registry.describeEntity(entity.key);
      const record = buildRecord(described.fields);

      let result;
      try {
        result = entity.schema.safeParse(record);
      } catch (error) {
        // The case this suite exists for: validation threw rather than
        // returning a verdict.
        assert.fail(
          `${entity.key}: the schema threw while validating — usually a helper ` +
            `referenced inside a .refine() that is not in scope in the schema ` +
            `module.\n${error.stack}`
        );
      }

      assert.equal(
        result.success,
        true,
        `${entity.key} rejected a record built from its own field description:\n` +
          JSON.stringify(result.success ? {} : result.error.issues, null, 1)
      );
    });
  }

  await t.test("every entity also accepts just its required fields", () => {
    // Guards the other direction: a field the registry reports as optional
    // that the schema actually insists on would make the AI's drafts, and the
    // form's own "what is still missing" line, quietly wrong.
    const failures = [];

    for (const entity of registry.ENTITIES) {
      const described = registry.describeEntity(entity.key);
      const result = entity.schema.safeParse(buildMinimalRecord(described.fields));
      if (!result.success) {
        failures.push(
          `${entity.key}: ${result.error.issues.map((i) => i.path.join(".")).join(", ")}`
        );
      }
    }

    assert.deepEqual(
      failures,
      [],
      `these schemas demand a field the registry describes as optional:\n${failures.join("\n")}`
    );
  });
});
