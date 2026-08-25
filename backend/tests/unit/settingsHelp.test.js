"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { SETTINGS } = require("../../src/core/settings/settingsRegistry");
const settingsService = require("../../src/core/settings/settings.service");

/**
 * Every configurable value has to explain itself.
 *
 * These screens are where an HR administrator makes decisions that change
 * everyone's pay and attendance weeks later, with no way to see the
 * consequence at the moment of choosing. A setting that ships with a control
 * but no explanation is how a grace period gets set to 0 by someone who
 * assumed it meant "no limit".
 *
 * This suite fails the build rather than the customer: add a setting to the
 * registry without help and the test goes red here, not silently in
 * production.
 */

test("settings help", async (t) => {
  await t.test("every setting explains what it does and gives an example", () => {
    const missing = SETTINGS.filter((s) => !s.help || !s.help.why || !s.help.example).map((s) => s.key);
    assert.deepEqual(
      missing,
      [],
      `these settings have a control but no explanation behind the info icon:\n${missing.join("\n")}`
    );
  });

  await t.test("the explanation is substantial enough to be worth opening", () => {
    // A one-liner belongs in `description`, which sits under the field
    // already. The info panel exists for the longer "what does this actually
    // change downstream" answer, so a stub there is worse than none — it
    // costs a click and tells the reader nothing new.
    const tooShort = SETTINGS.filter((s) => s.help.why.length < 80 || s.help.example.length < 60).map(
      (s) => `${s.key} (why: ${s.help.why.length} chars, example: ${s.help.example.length} chars)`
    );
    assert.deepEqual(tooShort, [], `these explanations are too thin to be useful:\n${tooShort.join("\n")}`);
  });

  await t.test("a numeric setting's example shows real numbers", () => {
    // For a number, "set it higher and more people qualify" is useless — the
    // reader needs to see an actual value and what it produces. A boolean or
    // enum is concrete without digits (its example contrasts the choices
    // instead), so this only applies where a number is being chosen.
    const numeric = SETTINGS.filter((s) => s.type === "number");
    const vague = numeric.filter((s) => !/\d/.test(s.help.example)).map((s) => s.key);
    assert.deepEqual(
      vague,
      [],
      `these numeric settings' examples contain no actual number:\n${vague.join("\n")}`
    );
    assert.ok(numeric.length > 5, "expected a meaningful number of numeric settings to be covered");
  });

  await t.test("the example says something the rest of the field does not already", () => {
    // Guards against the cheapest way this decays: pasting the label or the
    // one-line description into the example to satisfy the checks above.
    // Deliberately not a keyword test for "contrast" — good examples phrase
    // that many different ways, and a word list would fail honest prose while
    // still passing a lazy copy-paste.
    const duplicated = SETTINGS.filter((s) => {
      const example = s.help.example.trim().toLowerCase();
      const why = s.help.why.trim().toLowerCase();
      const description = (s.description || "").trim().toLowerCase();
      return (
        example === why ||
        example === description ||
        example === s.label.trim().toLowerCase() ||
        (description.length > 20 && example.includes(description))
      );
    }).map((s) => s.key);

    assert.deepEqual(
      duplicated,
      [],
      `these examples just repeat the label, description or explanation:\n${duplicated.join("\n")}`
    );
  });

  await t.test("help reaches the frontend in the settings payload", () => {
    // describe() whitelists the fields it sends, so help can be present in
    // the registry and still never arrive on screen — which is exactly what
    // happened the first time this was wired up.
    const source = require("node:fs").readFileSync(
      require.resolve("../../src/core/settings/settings.service"),
      "utf8"
    );
    assert.match(
      source,
      /help:\s*d\.help/,
      "settings.service.describe() must pass `help` through, or the info icons render with nothing behind them"
    );
    assert.equal(typeof settingsService.describe, "function");
  });
});
