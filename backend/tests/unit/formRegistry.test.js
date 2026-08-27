"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const registry = require("../../src/core/forms/formRegistry");
const HELP = require("../../src/core/forms/formHelp");
const { introspect } = require("../../src/core/forms/schemaIntrospect");

/**
 * The registry is only worth having while both of its halves stay true.
 *
 * Structure comes from the Zod schemas, so it cannot lie about what the API
 * accepts. Meaning is written by hand, and hand-written things rot: a field
 * gets added to a schema and nobody explains it, or a field is renamed and
 * its explanation stays behind pointing at nothing. Neither failure raises an
 * error anywhere — the form just renders an unexplained box, and the
 * assistant fills a field it does not understand.
 *
 * So the binding is asserted here rather than trusted. Adding a field to a
 * schema without explaining it fails this suite, which is the only moment
 * anyone is still looking.
 */

/** Every dotted path in an entity, including nested and array-item fields. */
function allPaths(fields, prefix = "") {
  const paths = [];
  for (const field of fields) {
    const path = prefix ? `${prefix}.${field.name}` : field.name;
    paths.push({ path, field });
    if (field.fields) paths.push(...allPaths(field.fields, path));
    if (field.itemFields) paths.push(...allPaths(field.itemFields, path));
  }
  return paths;
}

test("form registry", async (t) => {
  await t.test("every entity resolves and carries its fields", () => {
    assert.ok(registry.ENTITIES.length > 0, "the registry cannot be empty");

    for (const entity of registry.ENTITIES) {
      const described = registry.describeEntity(entity.key);
      assert.ok(described, `${entity.key} must resolve`);
      assert.ok(described.fields.length > 0, `${entity.key} must describe at least one field`);
      assert.ok(described.route, `${entity.key} needs a route or the assistant cannot send anyone to it`);
      assert.ok(
        described.permission,
        `${entity.key} needs the permission required to SAVE it — the AI draft endpoint gates on exactly this`
      );
    }
  });

  await t.test("every input a person can fill is explained", () => {
    // The whole point of the registry. A field with a control and no
    // explanation is how a flexible shift's minimum hours gets set to 60 by
    // someone who assumed the number was in hours.
    const missing = [];

    for (const entity of registry.ENTITIES) {
      const described = registry.describeEntity(entity.key);
      for (const { path, field } of allPaths(described.fields)) {
        // Containers are explained through their children; a reference is a
        // record picker whose meaning is its label.
        if (field.type === "object" || field.type === "reference") continue;
        if (!field.help || !field.help.why || !field.help.example) {
          missing.push(`${entity.key}.${path}`);
        }
      }
    }

    assert.deepEqual(missing, [], `these inputs have a control but no explanation:\n${missing.join("\n")}`);
  });

  await t.test("no explanation is left behind pointing at a field that is gone", () => {
    // The other direction, and the quieter one: rename a schema field and its
    // help stays in formHelp.js, still passing every coverage check above
    // while attached to nothing.
    const orphans = [];

    for (const entity of registry.ENTITIES) {
      const described = registry.describeEntity(entity.key);
      const real = new Set(allPaths(described.fields).map((p) => p.path));
      for (const path of Object.keys(HELP[entity.key] || {})) {
        if (!real.has(path)) orphans.push(`${entity.key}.${path}`);
      }
    }

    assert.deepEqual(
      orphans,
      [],
      `these explanations describe fields that no longer exist in the schema:\n${orphans.join("\n")}`
    );
  });

  await t.test("an explanation is substantial enough to be worth opening", () => {
    const tooShort = [];

    for (const entity of registry.ENTITIES) {
      for (const [path, help] of Object.entries(HELP[entity.key] || {})) {
        if (help.why.length < 80 || help.example.length < 60) {
          tooShort.push(`${entity.key}.${path} (why ${help.why.length}, example ${help.example.length})`);
        }
      }
    }

    assert.deepEqual(tooShort, [], `these explanations are too thin to be useful:\n${tooShort.join("\n")}`);
  });

  await t.test("a numeric or time field's example shows real values", () => {
    // "Set it higher and more people qualify" is useless for a number. The
    // reader needs an actual value and what it produces.
    const vague = [];

    for (const entity of registry.ENTITIES) {
      const described = registry.describeEntity(entity.key);
      for (const { path, field } of allPaths(described.fields)) {
        if (!field.help) continue;
        if (!["number", "integer", "time", "date"].includes(field.type)) continue;
        if (!/\d/.test(field.help.example)) vague.push(`${entity.key}.${path}`);
      }
    }

    assert.deepEqual(vague, [], `these examples contain no actual value:\n${vague.join("\n")}`);
  });

  await t.test("the example says something the label and explanation do not", () => {
    // Guards the cheapest way this decays: pasting the `why` into the
    // `example` to satisfy the length checks above.
    const duplicated = [];

    for (const entity of registry.ENTITIES) {
      for (const [path, help] of Object.entries(HELP[entity.key] || {})) {
        const example = help.example.trim().toLowerCase();
        const why = help.why.trim().toLowerCase();
        if (example === why || why.includes(example)) duplicated.push(`${entity.key}.${path}`);
      }
    }

    assert.deepEqual(duplicated, [], `these examples just repeat the explanation:\n${duplicated.join("\n")}`);
  });

  await t.test("the model is never asked to invent a record id", () => {
    // A reference field holds another record's id. It is the one value a
    // language model cannot know and will most confidently fabricate — a
    // 24-character id that parses, validates, and points at nothing.
    for (const entity of registry.ENTITIES) {
      const { responseSchema } = registry.draftSchemaFor(entity.key);
      const referenceFields = allPaths(introspect(entity.schema))
        .filter((p) => p.field.type === "reference")
        .map((p) => p.field.name);

      for (const name of referenceFields) {
        assert.equal(
          responseSchema.properties[name],
          undefined,
          `${entity.key}.${name} is a record id and must not be offered to the model`
        );
      }
      assert.ok(
        Object.keys(responseSchema.properties).length > 0,
        `${entity.key} must still offer the model something to fill`
      );
    }
  });

  await t.test("a draft schema's required list only names fields it actually offers", () => {
    // Dropping a reference field from `properties` while leaving it in
    // `required` produces a schema nothing can satisfy, so every draft fails.
    for (const entity of registry.ENTITIES) {
      const { responseSchema } = registry.draftSchemaFor(entity.key);
      for (const name of responseSchema.required || []) {
        assert.ok(
          responseSchema.properties[name],
          `${entity.key}: "${name}" is required but not offered — no draft could ever validate`
        );
      }
    }
  });

  await t.test("field notes reach the model with their enum values", () => {
    // The notes are what let the model pick "alternate" rather than inventing
    // "alternating". If the options stop being listed it starts guessing.
    const { fieldNotes } = registry.draftSchemaFor("shift");
    const typeNote = fieldNotes.find((line) => line.startsWith("- type "));

    assert.ok(typeNote, "the shift type field must appear in the notes");
    assert.match(typeNote, /fixed/, "its allowed values must be listed for the model");
    assert.match(typeNote, /flexible/);
  });

  await t.test("permissions filter what the assistant can even see", () => {
    const none = registry.describeAll([]);
    assert.deepEqual(none, [], "someone with no permissions is offered no forms at all");

    const shiftOnly = registry.describeAll(["shift.manage"]);
    assert.ok(shiftOnly.length > 0, "a permission the entities require does surface them");
    assert.ok(
      shiftOnly.every((e) => e.permission === "shift.manage"),
      "and nothing else leaks through"
    );

    assert.equal(registry.describeForPrompt([]).length, 0, "the prompt catalogue is filtered too");
  });

  await t.test("an unknown entity is refused rather than guessed at", () => {
    assert.equal(registry.describeEntity("not_a_real_entity"), null);
    assert.equal(registry.draftSchemaFor("not_a_real_entity"), null);
  });
});
