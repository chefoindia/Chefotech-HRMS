"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

/**
 * The AI credential encryption at rest.
 *
 * This is the only thing standing between a leaked database backup and every
 * tenant's Gemini API key being readable in plain text, so it is tested on
 * its own — properties that must hold regardless of which route calls it.
 */

function loadBox(key) {
  const saved = process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
  process.env.AI_CREDENTIAL_ENCRYPTION_KEY = key;

  // env.js reads process.env once at require time into a plain object, so a
  // module cached from an earlier test file keeps whichever key was set
  // first. Evicting both it and secretBox.js forces a fresh read.
  const RELOAD = ["config\\env.js", "config/env.js", "secretBox.js"];
  for (const path of Object.keys(require.cache)) {
    const normalised = path.split("\\").join("/");
    if (RELOAD.some((name) => normalised.endsWith(name.split("\\").join("/")))) {
      delete require.cache[path];
    }
  }

  const box = require("../../src/core/security/secretBox");
  return {
    box,
    restore() {
      if (saved === undefined) delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
      else process.env.AI_CREDENTIAL_ENCRYPTION_KEY = saved;
    },
  };
}

// Generated, not transcribed — a hand-typed hex string is exactly the kind of
// off-by-one that would make this suite validate the wrong thing.
const VALID_KEY = require("node:crypto").randomBytes(32).toString("hex");

test("AI credential encryption", async (t) => {
  await t.test("round-trips a value exactly", () => {
    const { box, restore } = loadBox(VALID_KEY);
    const secret = "AIzaSyExampleGeminiKeyForTesting1234";
    const encrypted = box.encrypt(secret);
    assert.equal(box.decrypt(encrypted), secret);
    restore();
  });

  await t.test("the ciphertext never contains the plaintext key", () => {
    const { box, restore } = loadBox(VALID_KEY);
    const secret = "AIzaSyExampleGeminiKeyForTesting1234";
    const encrypted = box.encrypt(secret);
    assert.ok(!JSON.stringify(encrypted).includes(secret));
    restore();
  });

  await t.test("a tampered authentication tag is rejected, not silently decrypted", () => {
    const { box, restore } = loadBox(VALID_KEY);
    const encrypted = box.encrypt("some-value");
    const tampered = { ...encrypted, authTag: box.encrypt("different").authTag };
    assert.throws(() => box.decrypt(tampered));
    restore();
  });

  await t.test("a tampered ciphertext is rejected", () => {
    const { box, restore } = loadBox(VALID_KEY);
    const encrypted = box.encrypt("some-value");
    const flipped = Buffer.from(encrypted.ciphertext, "base64");
    flipped[0] ^= 0xff;
    assert.throws(() => box.decrypt({ ...encrypted, ciphertext: flipped.toString("base64") }));
    restore();
  });

  await t.test("two encryptions of the same value produce different ciphertext", () => {
    // A fresh random IV every time — otherwise identical keys saved by two
    // different tenants would be recognisable as identical from the
    // ciphertext alone.
    const { box, restore } = loadBox(VALID_KEY);
    const a = box.encrypt("same-value");
    const b = box.encrypt("same-value");
    assert.notEqual(a.ciphertext, b.ciphertext);
    assert.notEqual(a.iv, b.iv);
    restore();
  });

  await t.test("refuses to run with no encryption key configured", () => {
    const { box, restore } = loadBox("");
    assert.throws(() => box.encrypt("x"), /AI_CREDENTIAL_ENCRYPTION_KEY/);
    restore();
  });

  await t.test("refuses a key of the wrong length", () => {
    const { box, restore } = loadBox("tooshort");
    assert.throws(() => box.encrypt("x"), /32 bytes/);
    restore();
  });

  await t.test("mask() never reveals enough to reconstruct the key", () => {
    const { box, restore } = loadBox(VALID_KEY);
    const secret = "AIzaSyExampleGeminiKeyForTesting1234";
    const masked = box.mask(secret);
    assert.ok(masked.includes("••••••••"));
    assert.ok(!masked.includes(secret.slice(4, -4)));
    restore();
  });
});
