"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { DEFAULT_RULES, materialise } = require("../../src/modules/notifications/defaultRules");
const { TEMPLATES } = require("../../src/modules/notifications/notificationTemplates");
const { RECIPIENT_TYPES } = require("../../src/modules/notifications/notificationRule.model");
const ruleService = require("../../src/modules/notifications/notificationRule.service");

/**
 * Notification rules decide who finds out that something happened.
 *
 * Every failure in this area is silent. A rule bound to an event name that no
 * template raises does not error — it simply never fires, and looks perfectly
 * healthy on the settings screen while the manager it was meant to copy hears
 * nothing for a month. Writing these tests caught exactly that: a default rule
 * pointed at "approval.escalated" when the event the workflow engine actually
 * raises is "workflow.escalated".
 *
 * The other half is the additive guarantee. Rules may only ever ADD people to
 * a notification, never remove them, because the recipients the product chose
 * are the ones who have to be told. A rule that could subtract would let a
 * misconfiguration stop an employee learning their own leave was rejected.
 */

const REAL_EVENTS = new Set(Object.values(TEMPLATES).map((t) => t.event));

test("notification rules", async (t) => {
  await t.test("every default rule fires on an event the product actually raises", () => {
    // The bug this suite was written for.
    const unknown = DEFAULT_RULES.filter((rule) => !REAL_EVENTS.has(rule.event)).map(
      (rule) => `${rule.name} → ${rule.event}`
    );

    assert.deepEqual(
      unknown,
      [],
      `these rules listen for events nothing emits, so they can never fire:\n${unknown.join("\n")}`
    );
  });

  await t.test("every default rule names a recipient type the resolver understands", () => {
    const bad = [];
    for (const rule of DEFAULT_RULES) {
      for (const spec of rule.recipients) {
        if (!RECIPIENT_TYPES.includes(spec.type)) bad.push(`${rule.name} → ${spec.type}`);
      }
    }
    assert.deepEqual(bad, [], `unknown recipient types:\n${bad.join("\n")}`);
  });

  await t.test("no default rule mails an unbounded audience", () => {
    // A default that emails the whole company on every join is how a customer
    // turns the notification system off in week one.
    for (const rule of DEFAULT_RULES) {
      assert.ok(rule.recipients.length > 0, `${rule.name} has no recipients`);
      for (const spec of rule.recipients) {
        assert.ok(
          ["reporting_manager", "department_head", "role", "subject", "actor"].includes(spec.type),
          `${rule.name} uses ${spec.type}, which is not a safe default audience`
        );
      }
    }
  });

  await t.test("every default rule explains itself", () => {
    // These are the first thing an administrator reads on that screen; a rule
    // whose purpose is not obvious gets disabled rather than tuned.
    for (const rule of DEFAULT_RULES) {
      assert.ok(rule.name && rule.name.length > 10, `${rule.event} needs a real name`);
      assert.ok(
        rule.description && rule.description.length >= 80,
        `${rule.name} needs a description that says why it exists`
      );
    }
  });

  await t.test("a role that does not exist skips the rule rather than seeding a dead one", async () => {
    // A rule pointing at a deleted role would look active and reach nobody.
    const NoRoles = { find: () => ({ select: () => ({ lean: async () => [] }) }) };
    const { rules, skipped } = await materialise(NoRoles);

    assert.ok(skipped.length > 0, "rules naming a missing role must be reported as skipped");
    assert.ok(
      rules.every((rule) => rule.recipients.every((r) => r.type !== "role")),
      "no seeded rule may reference a role that was not found"
    );
  });

  await t.test("role names resolve to ids when the roles are present", async () => {
    const WithRoles = {
      find: () => ({
        select: () => ({
          lean: async () => [
            { _id: "role-hr", name: "HR Manager" },
            { _id: "role-pay", name: "Payroll Admin" },
          ],
        }),
      }),
    };

    const { rules } = await materialise(WithRoles);
    const roleRules = rules.filter((rule) => rule.recipients.some((r) => r.type === "role"));

    assert.ok(roleRules.length >= 2, "the role-based defaults should have materialised");
    for (const rule of roleRules) {
      for (const spec of rule.recipients.filter((r) => r.type === "role")) {
        assert.ok(spec.roleIds && spec.roleIds.length, `${rule.name} resolved to no role id`);
        assert.equal(spec.roleName, undefined, "the name must not survive alongside the id");
      }
    }
    assert.ok(rules.every((r) => r.isSystemDefault), "seeded rules must be marked as defaults");
  });

  await t.test("merging never drops the recipients the product itself chose", () => {
    // The additive guarantee, stated as a test.
    const primary = [{ userId: "employee", email: "e@x.com" }];
    const extra = [{ userId: "manager", email: "m@x.com" }];

    const merged = ruleService.mergeRecipients(primary, extra);

    assert.equal(merged.length, 2);
    assert.equal(merged[0].userId, "employee", "the caller's own recipient stays first");
    assert.ok(merged.some((r) => r.userId === "manager"));
  });

  await t.test("the same person reached twice is told once", () => {
    const merged = ruleService.mergeRecipients(
      [{ userId: "u1", email: "a@x.com" }],
      [{ userId: "u1", email: "a@x.com" }, { email: "A@X.com" }, { email: "b@x.com" }]
    );

    // u1 by id, A@X.com is a different identity (no userId) but the same
    // address as a@x.com only in the primary — matched case-insensitively.
    assert.equal(merged.length, 3, JSON.stringify(merged));
    assert.equal(merged.filter((r) => r.userId === "u1").length, 1);
  });

  await t.test("a rule with no condition always applies", () => {
    assert.equal(ruleService.conditionHolds({ condition: null }, {}), true);
    assert.equal(ruleService.conditionHolds({ condition: "" }, {}), true);
  });

  await t.test("a condition is evaluated against the event's own data", () => {
    const rule = { _id: "r1", condition: "days >= 5" };
    assert.equal(ruleService.conditionHolds(rule, { days: 7 }), true);
    assert.equal(ruleService.conditionHolds(rule, { days: 2 }), false);
  });

  await t.test("a condition that cannot be evaluated errs towards sending", () => {
    // One extra email is recoverable. Silently withholding a notification the
    // administrator believes is configured is not — they find out when
    // somebody was not told something.
    const rule = { _id: "r1", condition: "this is not an expression (((" };
    assert.equal(ruleService.conditionHolds(rule, {}), true);
  });

  await t.test("an unknown recipient type resolves to nobody rather than throwing", async () => {
    const resolved = await ruleService.resolveRecipients(
      { _id: "r1", recipients: [{ type: "not_a_real_type" }] },
      {}
    );
    assert.deepEqual(resolved, []);
  });

  await t.test("subject and actor come straight from the event context", async () => {
    const subject = { userId: "s", email: "s@x.com" };
    const actor = { userId: "a", email: "a@x.com" };

    const resolved = await ruleService.resolveRecipients(
      { _id: "r1", recipients: [{ type: "subject" }, { type: "actor" }] },
      { subject, actor }
    );

    assert.deepEqual(resolved, [subject, actor]);
  });

  await t.test("an external address is accepted without a platform user", async () => {
    // A shared inbox or an outside auditor has no userId, so it can only ever
    // be emailed — there is no in-app bell to write to.
    const resolved = await ruleService.resolveRecipients(
      { _id: "r1", recipients: [{ type: "email", email: "audit@firm.example" }] },
      {}
    );

    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].email, "audit@firm.example");
    assert.equal(resolved[0].userId, null);
  });
});
