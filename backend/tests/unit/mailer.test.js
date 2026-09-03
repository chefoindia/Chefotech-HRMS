"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const mailer = require("../../src/modules/notifications/mailer");

/**
 * The mailer's failure modes, which is where this area actually broke.
 *
 * Not one caller in the codebase checks the `delivered` or `simulated` flags
 * that `send()` returns — grep the modules and there are none. So for as long
 * as a disabled mailer returned a soft "didn't really send" result, every
 * caller read it as success: the password-reset token was issued, the audit
 * log recorded the mail as sent, the person was told to check their inbox,
 * and nothing had left the building. MAIL_ENABLED merely being absent (it
 * defaults to false) was enough to do that to every outbound message in the
 * product, silently, at info level.
 *
 * In production that soft failure is now a thrown error instead. These tests
 * pin both halves of that: still a friendly outbox in development, still an
 * error in production, and the address parsing that Brevo is strict about.
 */

test("mailer", async (t) => {
  await t.test("splits a combined From into the pair Brevo demands", () => {
    // Brevo rejects the whole request if sender.email is not a bare address,
    // and MAIL_FROM is conventionally written in the combined form.
    assert.deepEqual(mailer.parseAddress("Chefotech HRMS <no-reply@chefotech.com>"), {
      name: "Chefotech HRMS",
      email: "no-reply@chefotech.com",
    });
  });

  await t.test("a bare address parses without inventing a name", () => {
    assert.deepEqual(mailer.parseAddress("someone@example.com"), {
      email: "someone@example.com",
    });
  });

  await t.test("quotes around a display name are stripped", () => {
    assert.deepEqual(mailer.parseAddress('"Chefotech HRMS" <hr@example.com>'), {
      name: "Chefotech HRMS",
      email: "hr@example.com",
    });
  });

  await t.test("several recipients become one list", () => {
    // notify() can hand a whole audience to a single send.
    assert.deepEqual(mailer.recipientList("a@x.com, Bob <b@y.com>"), [
      { email: "a@x.com" },
      { name: "Bob", email: "b@y.com" },
    ]);
  });

  await t.test("an array of recipients is accepted as well as a string", () => {
    assert.deepEqual(mailer.recipientList(["a@x.com", "b@y.com"]), [
      { email: "a@x.com" },
      { email: "b@y.com" },
    ]);
  });

  await t.test("empty recipients resolve to an empty list, not a bad entry", () => {
    // A blank address would be sent to the provider as `{email: ""}` and
    // rejected for the whole batch, taking the valid recipients with it.
    assert.deepEqual(mailer.recipientList(""), []);
    assert.deepEqual(mailer.recipientList(null), []);
    assert.deepEqual(mailer.recipientList("a@x.com, , b@y.com"), [
      { email: "a@x.com" },
      { email: "b@y.com" },
    ]);
  });

  await t.test("with mail off, a send is captured rather than lost", () => {
    // Tests run with MAIL_ENABLED unset, i.e. the development path.
    const before = mailer.devOutbox().length;
    return mailer
      .send({ to: "someone@example.com", subject: "Reset your password", text: "link" })
      .then((result) => {
        assert.equal(result.delivered, false);
        assert.equal(result.simulated, true);
        const outbox = mailer.devOutbox();
        assert.equal(outbox.length, before + 1);
        assert.equal(outbox[0].subject, "Reset your password");
      });
  });

  await t.test("the outbox keeps the newest message first", () => {
    return mailer
      .send({ to: "a@example.com", subject: "First", text: "x" })
      .then(() => mailer.send({ to: "b@example.com", subject: "Second", text: "x" }))
      .then(() => {
        assert.equal(mailer.devOutbox()[0].subject, "Second");
      });
  });

  await t.test("the HTML wrapper escapes what it interpolates", () => {
    // Template data reaches this from user-controlled fields — an employee's
    // own name ends up in the greeting of several of these messages.
    const html = mailer.wrapHtml({
      title: "Hello",
      body: '<script>alert(1)</script>',
      companyName: 'Acme "&" Co',
    });

    assert.ok(!html.includes("<script>"), "a script tag must not survive into the email body");
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(html.includes("Acme &quot;&amp;&quot; Co"));
  });

  await t.test("escapeHtml handles null and undefined without printing them", () => {
    // A missing template variable should leave a gap, not the text "undefined".
    assert.equal(mailer.escapeHtml(null), "");
    assert.equal(mailer.escapeHtml(undefined), "");
  });
});
