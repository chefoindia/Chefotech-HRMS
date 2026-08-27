"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { z } = require("zod");

const { introspect, fieldNames, toResponseSchema } = require("../../src/core/forms/schemaIntrospect");
const { timeString, dateString, objectId, hexColor, email } = require("../../src/core/validation/common");

/**
 * The form registry describes every input in the product by reading the Zod
 * schemas that already guard the endpoints. That indirection is what stops
 * the registry drifting from reality — but it only holds while the reading
 * itself is right.
 *
 * Getting it wrong is quiet and expensive. Mistype a time field as a plain
 * string and the AI proposes "9am" into a field the API only accepts "09:00"
 * for. Miss an `.optional()` and a draft is reported as incomplete forever.
 * Worst of all, let a `reference` field through to the model and it will
 * invent a 24-character id that points at nothing — the one value in an HR
 * record that absolutely cannot be guessed.
 */

test("schema introspection", async (t) => {
  await t.test("required, optional and defaulted fields are told apart", () => {
    const schema = z.object({
      name: z.string().min(1),
      nickname: z.string().optional(),
      isActive: z.boolean().default(true),
    });

    const byName = Object.fromEntries(introspect(schema).map((f) => [f.name, f]));

    assert.equal(byName.name.required, true, "a bare field is required");
    assert.equal(byName.nickname.required, false, ".optional() is not required");
    assert.equal(
      byName.isActive.required,
      false,
      "a field with a default is not something the user must supply"
    );
    assert.equal(byName.isActive.default, true, "the default value itself is reported");
  });

  await t.test("the wire formats are recovered, not flattened to string", () => {
    // These are all z.string() underneath. If they arrive as "string" the AI
    // has no way to know it must emit "09:00" rather than "9am", and the UI
    // has no way to know to render a picker.
    const schema = z.object({
      startTime: timeString(),
      joinedOn: dateString(),
      colour: hexColor(),
      workEmail: email(),
    });

    const byName = Object.fromEntries(introspect(schema).map((f) => [f.name, f]));

    assert.equal(byName.startTime.type, "time");
    assert.equal(byName.joinedOn.type, "date");
    assert.equal(byName.colour.type, "colour");
    assert.equal(byName.workEmail.type, "email");
  });

  await t.test("an id pointing at another record is never offered to the model", () => {
    const schema = z.object({
      name: z.string().min(1),
      departmentId: objectId(),
    });

    const fields = introspect(schema);
    const department = fields.find((f) => f.name === "departmentId");
    assert.equal(department.type, "reference", "objectId() is a pointer, not free text");

    const responseSchema = toResponseSchema(fields);
    assert.ok(responseSchema.properties.name, "ordinary fields still reach the model");
    assert.equal(
      responseSchema.properties.departmentId,
      undefined,
      "a reference must not appear in the model's schema — it would invent an id that resolves to nothing"
    );
    assert.ok(
      !(responseSchema.required || []).includes("departmentId"),
      "and a dropped field must not be left behind in `required`, which would make every draft invalid"
    );
  });

  await t.test("enum options reach the model so it cannot invent a value", () => {
    const schema = z.object({ mode: z.enum(["annual", "monthly", "accrual"]) });

    const [field] = introspect(schema);
    assert.deepEqual(field.options, ["annual", "monthly", "accrual"]);
    assert.deepEqual(toResponseSchema([field]).properties.mode.enum, ["annual", "monthly", "accrual"]);
  });

  await t.test("numeric bounds survive, and integers stay integers", () => {
    const schema = z.object({
      graceMinutes: z.number().int().min(0).max(120),
      rate: z.number().min(0.5),
    });

    const byName = Object.fromEntries(introspect(schema).map((f) => [f.name, f]));

    assert.equal(byName.graceMinutes.type, "integer");
    assert.equal(byName.graceMinutes.min, 0);
    assert.equal(byName.graceMinutes.max, 120);
    assert.equal(byName.rate.type, "number", "a non-integer number must not be rounded into one");
    assert.equal(toResponseSchema([byName.graceMinutes]).properties.graceMinutes.type, "integer");
  });

  await t.test("nested objects and arrays of objects are described, not skipped", () => {
    // A leave rule's real shape. If nesting collapsed, allocation.mode would
    // be invisible to both the help system and the model.
    const schema = z.object({
      allocation: z.object({
        mode: z.enum(["annual", "monthly"]),
        daysPerPeriod: z.number(),
      }),
      days: z.array(z.object({ day: z.number().int(), type: z.enum(["working", "off"]) })).max(7),
    });

    const byName = Object.fromEntries(introspect(schema).map((f) => [f.name, f]));

    assert.equal(byName.allocation.type, "object");
    assert.deepEqual(
      byName.allocation.fields.map((f) => f.name),
      ["mode", "daysPerPeriod"]
    );

    assert.equal(byName.days.type, "array");
    assert.equal(byName.days.itemType, "object");
    assert.deepEqual(
      byName.days.itemFields.map((f) => f.name),
      ["day", "type"]
    );

    const responseSchema = toResponseSchema(introspect(schema));
    assert.equal(responseSchema.properties.allocation.properties.mode.type, "string");
    assert.deepEqual(responseSchema.properties.allocation.properties.mode.enum, ["annual", "monthly"]);
    assert.equal(responseSchema.properties.days.items.properties.day.type, "integer");
  });

  await t.test("a nullable optional resolves to the type underneath both wrappers", () => {
    // `.nullable().optional()` is how this codebase says "may be cleared" —
    // two wrappers deep. Stopping at the first leaves the field typed unknown.
    const schema = z.object({ coreStartTime: timeString().nullable().optional() });

    const [field] = introspect(schema);
    assert.equal(field.type, "time");
    assert.equal(field.required, false);
    assert.equal(field.nullable, true);
  });

  await t.test("fieldNames lists exactly the schema's own keys", () => {
    const schema = z.object({ a: z.string(), b: z.number().optional() });
    assert.deepEqual(fieldNames(schema), ["a", "b"]);
    assert.deepEqual(fieldNames(schema.partial()), ["a", "b"], "a .partial() covers the same fields");
  });

  await t.test("a non-object schema degrades quietly instead of throwing", () => {
    // Reached if someone points the registry at a schema that is not a form.
    // Returning nothing is recoverable; throwing takes the API down at boot.
    assert.deepEqual(introspect(z.string()), []);
    assert.deepEqual(fieldNames(null), []);
    assert.deepEqual(introspect(undefined), []);
  });
});
