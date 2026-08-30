"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { StepSchema, WorkflowSchema } = require("../../src/modules/workflow/workflow.schema");

/**
 * Approval steps, validated the way a real request arrives.
 *
 * These schemas went unexercised for the one field that could break them. The
 * step's `condition` carried a `.refine()` that called the formula engine —
 * and because the whole expression ended in `|| true` it could never reject
 * anything, so nobody noticed it was there. When the schemas moved into their
 * own module for the form registry, the engine reference came with them and
 * the import did not: every step carrying a condition threw a ReferenceError
 * at parse time, and the whole suite still passed, because no test had ever
 * submitted a step with a condition on it.
 *
 * The real check lives in workflow.routes.js `beforeCreate`, where it can name
 * the failing step. What is asserted here is that the shape itself accepts
 * what an approval chain actually looks like.
 */

const STEP = {
  order: 1,
  name: "Reporting manager",
  approverType: "reporting_manager",
};

test("workflow schemas", async (t) => {
  await t.test("a step carrying a condition parses", () => {
    // The exact case that threw. A condition is ordinary — "only escalate for
    // leave longer than five days" is the reason multi-step workflows exist.
    const result = StepSchema.safeParse({ ...STEP, condition: "days > 5" });
    assert.equal(result.success, true, result.success ? "" : JSON.stringify(result.error?.issues));
    assert.equal(result.data.condition, "days > 5");
  });

  await t.test("a condition may be cleared", () => {
    assert.equal(StepSchema.safeParse({ ...STEP, condition: null }).success, true);
    assert.equal(StepSchema.safeParse({ ...STEP, condition: undefined }).success, true);
  });

  await t.test("an over-long condition is still refused", () => {
    // Removing the dead refine must not have removed the length bound with it.
    assert.equal(StepSchema.safeParse({ ...STEP, condition: "x".repeat(501) }).success, false);
  });

  await t.test("every approver type the resolver understands is accepted", () => {
    for (const approverType of [
      "reporting_manager",
      "manager_level",
      "department_head",
      "role",
      "permission",
      "specific_users",
      "requester",
    ]) {
      assert.equal(
        StepSchema.safeParse({ ...STEP, approverType }).success,
        true,
        `${approverType} must be a valid approver type`
      );
    }
    assert.equal(StepSchema.safeParse({ ...STEP, approverType: "ceo" }).success, false);
  });

  await t.test("a workflow needs at least one step", () => {
    // A workflow with no steps would accept a request and then have nobody to
    // send it to, leaving it pending forever with no visible cause.
    const base = { name: "Leave approval", code: "LEAVE", entityType: "leave_request" };

    assert.equal(WorkflowSchema.safeParse({ ...base, steps: [] }).success, false);
    assert.equal(WorkflowSchema.safeParse({ ...base, steps: [STEP] }).success, true);
  });

  await t.test("a multi-step chain with escalation parses whole", () => {
    // What the editor actually submits: two levels, the second gated on a
    // condition and escalating if it sits unanswered.
    const result = WorkflowSchema.safeParse({
      name: "Long leave",
      code: "LONGLEAVE",
      entityType: "leave_request",
      steps: [
        { order: 1, name: "Reporting manager", approverType: "reporting_manager", canReject: true },
        {
          order: 2,
          name: "Department head",
          approverType: "department_head",
          condition: "days > 5",
          mode: "any",
          escalateAfterDays: 2,
          skipIfSelf: true,
        },
      ],
      priority: 10,
    });

    assert.equal(result.success, true, result.success ? "" : JSON.stringify(result.error?.issues));
    assert.equal(result.data.steps.length, 2);
    assert.equal(result.data.steps[1].escalateAfterDays, 2);
  });

  await t.test("step order stays within the twenty the model allows", () => {
    assert.equal(StepSchema.safeParse({ ...STEP, order: 0 }).success, false);
    assert.equal(StepSchema.safeParse({ ...STEP, order: 21 }).success, false);
    assert.equal(StepSchema.safeParse({ ...STEP, order: 20 }).success, true);
  });
});
