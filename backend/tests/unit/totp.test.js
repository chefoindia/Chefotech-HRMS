"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const totp = require("../../src/core/security/totp");
const ipRange = require("../../src/core/security/ipRange");

/**
 * The TOTP implementation is checked against the published RFC 6238 test
 * vectors (Appendix B, SHA-1, secret "12345678901234567890"), so an
 * authenticator app and this server agree on every code.
 */
const RFC_SECRET = totp.base32Encode(Buffer.from("12345678901234567890", "ascii"));

test("matches the RFC 6238 SHA-1 test vectors", () => {
  const vectors = [
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ];
  for (const [seconds, expected] of vectors) {
    assert.equal(totp.generateToken(RFC_SECRET, seconds * 1000), expected, `at t=${seconds}`);
  }
});

test("base32 round-trips", () => {
  const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 42]);
  assert.deepEqual([...totp.base32Decode(totp.base32Encode(bytes))], [...bytes]);
  assert.equal(totp.generateSecret().length, 32);
});

test("verify accepts one step of drift and reports the counter it matched", () => {
  const now = 1_700_000_000_000;
  const current = totp.generateToken(RFC_SECRET, now);
  const previous = totp.generateToken(RFC_SECRET, now - 30_000);
  const tooOld = totp.generateToken(RFC_SECRET, now - 90_000);

  assert.equal(totp.verify(RFC_SECRET, current, { at: now }).valid, true);
  assert.equal(totp.verify(RFC_SECRET, previous, { at: now }).valid, true);
  assert.equal(totp.verify(RFC_SECRET, tooOld, { at: now }).valid, false);
  assert.equal(totp.verify(RFC_SECRET, "12345", { at: now }).valid, false, "five digits is never a code");
  assert.equal(totp.verify(RFC_SECRET, "abcdef", { at: now }).valid, false);

  const matched = totp.verify(RFC_SECRET, previous, { at: now });
  assert.equal(matched.counter, Math.floor(now / 1000 / 30) - 1);
});

test("recovery codes are unambiguous and hash consistently regardless of formatting", () => {
  const codes = totp.generateRecoveryCodes(10);
  assert.equal(codes.length, 10);
  for (const code of codes) {
    assert.match(code, /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/, `${code} uses only unambiguous characters`);
  }
  assert.equal(totp.hashRecoveryCode("abcde-fghjk"), totp.hashRecoveryCode("ABCDEFGHJK"));
  assert.equal(totp.hashRecoveryCode(" ABCDE FGHJK "), totp.hashRecoveryCode("ABCDE-FGHJK"));
});

test("otpauth URL carries the pieces an authenticator app reads", () => {
  const url = totp.otpauthUrl({ secret: "ABC234", account: "asha@alpha.test", issuer: "ChefoTech HRMS" });
  assert.ok(url.startsWith("otpauth://totp/ChefoTech%20HRMS%3Aasha%40alpha.test?"));
  assert.ok(url.includes("secret=ABC234"));
  assert.ok(url.includes("issuer=ChefoTech+HRMS"));
  assert.ok(url.includes("period=30"));
});

// ── IP ranges ────────────────────────────────────────────────────────────────

test("plain addresses, IPv4 CIDR and mapped addresses match as expected", () => {
  assert.equal(ipRange.matches("203.0.113.14", "203.0.113.14"), true);
  assert.equal(ipRange.matches("203.0.113.15", "203.0.113.14"), false);
  assert.equal(ipRange.matches("10.42.7.9", "10.0.0.0/8"), true);
  assert.equal(ipRange.matches("11.0.0.1", "10.0.0.0/8"), false);
  assert.equal(ipRange.matches("192.168.1.200", "192.168.1.128/25"), true);
  assert.equal(ipRange.matches("192.168.1.100", "192.168.1.128/25"), false);
  assert.equal(ipRange.matches("::ffff:203.0.113.14", "203.0.113.0/24"), true, "Node reports dual-stack clients in mapped form");
  assert.equal(ipRange.matches("127.0.0.1", "0.0.0.0/0"), true);
});

test("IPv6 ranges match and version mismatches never match", () => {
  assert.equal(ipRange.matches("2001:db8:1::5", "2001:db8::/32"), true);
  assert.equal(ipRange.matches("2001:db9::1", "2001:db8::/32"), false);
  assert.equal(ipRange.matches("::1", "::1"), true);
  assert.equal(ipRange.matches("::1", "127.0.0.1"), false);
  assert.equal(ipRange.matches("203.0.113.14", "2001:db8::/32"), false);
});

test("a malformed entry never matches and never throws; isAllowed is open when the list is empty", () => {
  assert.equal(ipRange.matches("203.0.113.14", "not-an-ip"), false);
  assert.equal(ipRange.matches("203.0.113.14", "203.0.113.0/40"), false);
  assert.equal(ipRange.matches("203.0.113.14", ""), false);
  assert.equal(ipRange.isAllowed("203.0.113.14", []), true);
  assert.equal(ipRange.isAllowed("203.0.113.14", ["garbage", "203.0.113.0/24"]), true);
  assert.equal(ipRange.isAllowed("198.51.100.1", ["garbage", "203.0.113.0/24"]), false);
  assert.deepEqual(ipRange.invalidEntries(["203.0.113.0/24", "garbage", "10.0.0.0/33", "::1"]), ["garbage", "10.0.0.0/33"]);
});
