"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { interpretCalls } = require("../../src/modules/ai/chatbot.service");
const registry = require("../../src/modules/ai/actionRegistry");

/**
 * Everything Gemini hands back, treated as untrusted input.
 *
 * Function calling constrains the model to declared names and an enum of
 * action ids, which is what stops it inventing a route. It does not constrain
 * the model to the declared *shape*: a parameter typed ARRAY comes back as a
 * bare object often enough to matter, several calls in one turn arrive in no
 * guaranteed order, and `args` can be absent entirely. Each of those reached
 * a user as a 500 on a chat message or as a prefill that silently vanished.
 *
 * The permission assertions matter for a different reason. Every action the
 * chatbot returns is something the frontend then performs, so a permission
 * check missed here is a screen someone reaches by asking for it.
 */

const ALL = registry.ACTIONS.map((a) => a.id);
const TOUR = registry.ACTIONS.find((a) => a.kind === "tour");
const ALL_PERMISSIONS = [...new Set(registry.ACTIONS.map((a) => a.permission).filter(Boolean))];

test("chatbot function calls", async (t) => {
  await t.test("a tour and its prefill arrive as one action", () => {
    const actions = interpretCalls(
      [
        { name: "start_tour", args: { actionId: TOUR.id } },
        {
          name: "suggest_field_values",
          args: { actionId: TOUR.id, values: [{ field: TOUR.fields[0].field, value: "09:00" }] },
        },
      ],
      ALL_PERMISSIONS
    );

    assert.equal(actions.length, 1);
    assert.equal(actions[0].type, "start_tour");
    assert.equal(actions[0].prefill[TOUR.fields[0].field], "09:00");
  });

  await t.test("the prefill still lands when it is emitted before the tour", () => {
    // Parallel function calls have no guaranteed order. The single-pass
    // version dropped the values whenever they came first, and the user was
    // asked to retype what they had already said.
    const actions = interpretCalls(
      [
        {
          name: "suggest_field_values",
          args: { actionId: TOUR.id, values: [{ field: TOUR.fields[0].field, value: "09:00" }] },
        },
        { name: "start_tour", args: { actionId: TOUR.id } },
      ],
      ALL_PERMISSIONS
    );

    assert.equal(actions.length, 1);
    assert.equal(
      actions[0].prefill[TOUR.fields[0].field],
      "09:00",
      "order of the model's calls must not decide whether the value survives"
    );
  });

  await t.test("a bare object where an array was declared does not throw", () => {
    // `for...of` over an object is a TypeError, which surfaced as a 500 on an
    // ordinary chat message.
    const actions = interpretCalls(
      [
        { name: "start_tour", args: { actionId: TOUR.id } },
        {
          name: "suggest_field_values",
          args: { actionId: TOUR.id, values: { field: TOUR.fields[0].field, value: "09:00" } },
        },
      ],
      ALL_PERMISSIONS
    );

    assert.equal(actions[0].prefill[TOUR.fields[0].field], "09:00", "and the single value is still used");
  });

  await t.test("a call with no args at all is ignored rather than fatal", () => {
    const actions = interpretCalls(
      [
        { name: "navigate_to" },
        { name: "start_tour", args: undefined },
        { name: "suggest_field_values", args: null },
      ],
      ALL_PERMISSIONS
    );

    assert.deepEqual(actions, []);
  });

  await t.test("a prefill for a tour that was not started is discarded", () => {
    // Otherwise it writes into whichever tour happened to be started last —
    // validating the field names against one action while applying them to
    // another.
    const otherTour = registry.ACTIONS.find((a) => a.kind === "tour" && a.id !== TOUR.id);

    const actions = interpretCalls(
      [
        { name: "start_tour", args: { actionId: TOUR.id } },
        {
          name: "suggest_field_values",
          args: { actionId: otherTour.id, values: [{ field: otherTour.fields[0]?.field, value: "x" }] },
        },
      ],
      ALL_PERMISSIONS
    );

    assert.equal(actions.length, 1);
    assert.deepEqual(actions[0].prefill, {}, "a value meant for another tour must not leak into this one");
  });

  await t.test("a field the tour does not have is refused", () => {
    const actions = interpretCalls(
      [
        { name: "start_tour", args: { actionId: TOUR.id } },
        {
          name: "suggest_field_values",
          args: { actionId: TOUR.id, values: [{ field: "not_a_real_field", value: "x" }] },
        },
      ],
      ALL_PERMISSIONS
    );

    assert.deepEqual(actions[0].prefill, {});
  });

  await t.test("an invented action id resolves to nothing", () => {
    const actions = interpretCalls(
      [{ name: "navigate_to", args: { actionId: "definitely_not_real" } }],
      ALL_PERMISSIONS
    );
    assert.deepEqual(actions, []);
  });

  await t.test("an action the caller may not reach is never returned", () => {
    // The chatbot is open to anyone signed in, so this is the only thing
    // standing between a chat message and a screen the person cannot open.
    const gated = registry.ACTIONS.find((a) => a.permission);
    assert.ok(gated, "expected at least one permission-gated action to test with");

    const actions = interpretCalls([{ name: "navigate_to", args: { actionId: gated.id } }], []);
    assert.deepEqual(actions, [], `${gated.id} requires ${gated.permission} and must not be offered without it`);
  });

  await t.test("start_tour refuses an id that is not a tour", () => {
    // Every id shares one namespace, so a page id reaching start_tour would
    // launch the engine against a walkthrough that does not exist.
    const page = registry.ACTIONS.find((a) => a.kind === "page");
    const actions = interpretCalls([{ name: "start_tour", args: { actionId: page.id } }], ALL_PERMISSIONS);
    assert.deepEqual(actions, []);
  });

  await t.test("an unknown function name is ignored, not treated as an action", () => {
    const actions = interpretCalls([{ name: "delete_everything", args: {} }], ALL_PERMISSIONS);
    assert.deepEqual(actions, []);
  });

  await t.test("no calls at all is an empty action list", () => {
    assert.deepEqual(interpretCalls([], ALL_PERMISSIONS), []);
    assert.ok(Array.isArray(ALL), "sanity: the registry exposes ids");
  });
});
