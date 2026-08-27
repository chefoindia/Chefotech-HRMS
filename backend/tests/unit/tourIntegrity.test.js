"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { TOURS } = require("../../src/modules/help/tours");

/**
 * A guided tour is the one part of this product that takes the wheel. When a
 * step is malformed the engine does not error — it renders a control the user
 * cannot satisfy and waits, so the failure looks like the user's fault.
 *
 * The case that prompted this suite: the payroll walkthrough's "which month?"
 * step was a required `select` carrying neither `options` nor `optionsFrom`.
 * It rendered an empty dropdown, the answer could never become non-empty, and
 * because a step needing input renders no Skip button, the only ways out were
 * Back or abandoning the tour. Every other select in the file had one or the
 * other, so nothing looked wrong on a read-through.
 *
 * These assertions are about internal consistency — that a step can be
 * completed at all. Whether its selector matches a real element in the
 * frontend is checked separately, in deepLinks.test.js.
 */

const ALL_STEPS = TOURS.flatMap((tour) => tour.steps.map((step) => ({ tour: tour.id, step })));

test("tour integrity", async (t) => {
  await t.test("every tour has an id, a title and at least one step", () => {
    for (const tour of TOURS) {
      assert.ok(tour.id, "a tour without an id cannot be started by the chatbot");
      assert.ok(tour.title, `${tour.id} needs a title — it is what the assistant offers`);
      assert.ok(tour.steps.length > 0, `${tour.id} has no steps`);
    }
  });

  await t.test("step ids are unique within their tour", () => {
    // Progress is persisted by step id. Two steps sharing one id makes resume
    // land on whichever the lookup finds first.
    for (const tour of TOURS) {
      const ids = tour.steps.map((s) => s.id);
      assert.deepEqual(
        ids.filter((id, i) => ids.indexOf(id) !== i),
        [],
        `${tour.id} has duplicate step ids`
      );
    }
  });

  await t.test("a select step can actually offer something to select", () => {
    // The bug this suite was written for.
    const empty = ALL_STEPS.filter(
      ({ step }) =>
        step.action === "select" &&
        !(step.options && step.options.length) &&
        !step.optionsFrom
    ).map(({ tour, step }) => `${tour}/${step.id}`);

    assert.deepEqual(
      empty,
      [],
      `these select steps render an empty dropdown, so the user can never answer them:\n${empty.join("\n")}`
    );
  });

  await t.test("a required step is one the user can complete", () => {
    // Required + no way to produce a value is a dead end with no Skip button.
    const trapped = ALL_STEPS.filter(({ step }) => {
      if (!step.validate || !step.validate.required) return false;
      if (step.action === "select") return !(step.options && step.options.length) && !step.optionsFrom;
      // A step that asks for something must have somewhere to put it.
      return !step.field && !step.target;
    }).map(({ tour, step }) => `${tour}/${step.id}`);

    assert.deepEqual(trapped, [], `these required steps cannot be satisfied:\n${trapped.join("\n")}`);
  });

  await t.test("hand-written select options are well formed", () => {
    for (const { tour, step } of ALL_STEPS) {
      for (const option of step.options || []) {
        assert.ok(
          option.value !== undefined && option.value !== null && option.value !== "",
          `${tour}/${step.id} has an option with no value — selecting it would read as empty`
        );
        assert.ok(option.label, `${tour}/${step.id} has an option with no label`);
      }
    }
  });

  await t.test("a step that waits for an element says which element", () => {
    // completeWhen elementVisible/elementGone with no completeTarget never
    // fires, so the tour stalls on that step forever.
    const stalled = ALL_STEPS.filter(
      ({ step }) =>
        ["elementVisible", "elementGone"].includes(step.completeWhen) && !step.completeTarget
    ).map(({ tour, step }) => `${tour}/${step.id}`);

    assert.deepEqual(stalled, [], `these steps wait on an element they never name:\n${stalled.join("\n")}`);
  });

  await t.test("a step that fills a field names the field", () => {
    const unbound = ALL_STEPS.filter(
      ({ step }) => ["fill", "select"].includes(step.action) && !step.field
    ).map(({ tour, step }) => `${tour}/${step.id}`);

    assert.deepEqual(
      unbound,
      [],
      `these steps collect a value with nowhere to record it:\n${unbound.join("\n")}`
    );
  });

  await t.test("numeric validation ranges are the right way round", () => {
    // min above max rejects every possible answer, which presents as the
    // user's value always being wrong.
    for (const { tour, step } of ALL_STEPS) {
      const v = step.validate;
      if (!v || v.min === undefined || v.max === undefined) continue;
      assert.ok(v.min <= v.max, `${tour}/${step.id} has min ${v.min} above max ${v.max}`);
    }
  });
});
