"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { keepValidFields, missingRequired } = require("../../src/modules/ai/formDraft.service");
const { ShiftSchema } = require("../../src/modules/shifts/shift.schema");
const { introspect } = require("../../src/core/forms/schemaIntrospect");

/**
 * The gate between a language model and a form an administrator is about to
 * save.
 *
 * The model is constrained by a generated JSON schema, which stops it
 * inventing field names but not bad values — enums come back subtly misspelled
 * and times come back as "9am" often enough to matter. Whatever slips through
 * lands in a real input on a real screen, and the person's reasonable
 * assumption is that anything shown there is valid.
 *
 * The design decision under test is that one bad field must not cost the
 * other eleven. Validating the object as a whole would be less code and a
 * far worse experience: a single malformed time would empty the entire form
 * and explain nothing.
 */

test("AI form drafts", async (t) => {
  await t.test("good values pass through, parsed rather than echoed", () => {
    const { accepted, rejected } = keepValidFields(ShiftSchema, {
      name: "  General shift  ",
      code: "GEN",
      startTime: "09:00",
      endTime: "18:00",
      breakMinutes: 60,
    });

    assert.deepEqual(rejected, []);
    assert.equal(
      accepted.name,
      "General shift",
      "the field's own .trim() must be applied — the form receives what the API would store"
    );
    assert.equal(accepted.breakMinutes, 60);
  });

  await t.test("one bad field does not discard the good ones", () => {
    // The whole point. "9am" is the single most likely thing to come back
    // wrong; losing the other four fields over it would be indefensible.
    const { accepted, rejected } = keepValidFields(ShiftSchema, {
      name: "Night shift",
      code: "NIGHT",
      startTime: "9am",
      endTime: "06:00",
    });

    assert.deepEqual(Object.keys(accepted).sort(), ["code", "endTime", "name"]);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].field, "startTime");
    assert.equal(rejected[0].proposed, "9am", "the rejected value is reported so the reason is explainable");
    assert.ok(rejected[0].reason, "and it says why, rather than failing silently");
  });

  await t.test("a misspelled enum value is refused, not coerced", () => {
    // Coercing "Fixed" to "fixed" would be helpful exactly until the day it
    // guesses wrong between two similar options.
    const { accepted, rejected } = keepValidFields(ShiftSchema, { type: "Fixed" });

    assert.equal(accepted.type, undefined);
    assert.equal(rejected[0].field, "type");
  });

  await t.test("a value outside the schema's range is dropped", () => {
    const { accepted, rejected } = keepValidFields(ShiftSchema, {
      name: "Long break shift",
      breakMinutes: 900, // schema caps this at 480
    });

    assert.equal(accepted.name, "Long break shift");
    assert.equal(accepted.breakMinutes, undefined, "an out-of-range number must never reach the form");
    assert.equal(rejected[0].field, "breakMinutes");
  });

  await t.test("a field that is not on the form is refused", () => {
    // Only reachable if the model ignores its generated schema outright, but
    // silently passing it through would put an unknown key into a form body.
    const { accepted, rejected } = keepValidFields(ShiftSchema, { salary: 50000 });

    assert.deepEqual(accepted, {});
    assert.equal(rejected[0].field, "salary");
    assert.match(rejected[0].reason, /not a field/);
  });

  await t.test("empty and malformed model output degrade to an empty draft", () => {
    // A draft with nothing in it is a recoverable outcome the caller can
    // report. A thrown TypeError inside a request handler is not.
    assert.deepEqual(keepValidFields(ShiftSchema, null).accepted, {});
    assert.deepEqual(keepValidFields(ShiftSchema, undefined).accepted, {});
    assert.deepEqual(keepValidFields(ShiftSchema, {}).rejected, []);
  });

  await t.test("required fields the draft missed are reported back", () => {
    // The form uses this to show what still needs a human, rather than
    // presenting a half-filled record as finished.
    const fields = introspect(ShiftSchema);

    const partial = missingRequired(fields, { name: "General", code: "GEN" });
    assert.deepEqual(partial.sort(), ["endTime", "startTime"]);

    const complete = missingRequired(fields, {
      name: "General",
      code: "GEN",
      startTime: "09:00",
      endTime: "18:00",
    });
    assert.deepEqual(complete, [], "a fully drafted record reports nothing outstanding");
  });

  await t.test("an optional field is never reported as missing", () => {
    // breakMinutes and colour are optional; demanding them would make every
    // draft look incomplete forever.
    const fields = introspect(ShiftSchema);
    const outstanding = missingRequired(fields, {
      name: "General",
      code: "GEN",
      startTime: "09:00",
      endTime: "18:00",
    });

    assert.ok(!outstanding.includes("breakMinutes"));
    assert.ok(!outstanding.includes("colour"));
    assert.ok(!outstanding.includes("isDefault"));
  });
});
