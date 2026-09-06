"use strict";

const crypto = require("node:crypto");

/**
 * Time-based one-time passwords (RFC 6238 over RFC 4226 HOTP).
 *
 * Written against the RFCs directly rather than pulling in a library: the
 * whole algorithm is forty lines, every authenticator app implements the
 * same defaults (SHA-1, 6 digits, 30-second steps), and a dependency here
 * is one more thing to audit for the part of the platform that guards
 * sign-in.
 */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(text) {
  const clean = String(text || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    value = (value << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** A fresh 160-bit secret, base32 for the QR / manual entry. */
function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function hotp(secretBase32, counter) {
  const key = base32Decode(secretBase32);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", key).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(code % 10 ** DIGITS).padStart(DIGITS, "0");
}

/** The code for a moment in time — used by tests and by nothing else. */
function generateToken(secretBase32, at = Date.now()) {
  return hotp(secretBase32, Math.floor(at / 1000 / STEP_SECONDS));
}

/**
 * Verify a code, allowing one step of clock drift either side. Uses a
 * constant-time comparison so a wrong code costs the same as a right one.
 * Returns the matched counter so a caller can refuse to accept the same
 * code twice (replay within the window).
 */
function verify(secretBase32, token, { window = 1, at = Date.now() } = {}) {
  const clean = String(token || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return { valid: false, counter: null };
  const counter = Math.floor(at / 1000 / STEP_SECONDS);
  for (let offset = -window; offset <= window; offset += 1) {
    const expected = hotp(secretBase32, counter + offset);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) {
      return { valid: true, counter: counter + offset };
    }
  }
  return { valid: false, counter: null };
}

/** The otpauth:// URI an authenticator app reads from the QR code. */
function otpauthUrl({ secret, account, issuer }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Recovery codes: ten groups of 10 characters, unambiguous alphabet. */
function generateRecoveryCodes(count = 10) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const codes = [];
  for (let i = 0; i < count; i += 1) {
    const bytes = crypto.randomBytes(10);
    let code = "";
    for (const b of bytes) code += alphabet[b % alphabet.length];
    codes.push(`${code.slice(0, 5)}-${code.slice(5)}`);
  }
  return codes;
}

function hashRecoveryCode(code) {
  return crypto.createHash("sha256").update(String(code).toUpperCase().replace(/[^A-Z0-9]/g, "")).digest("hex");
}

module.exports = { generateSecret, generateToken, verify, otpauthUrl, generateRecoveryCodes, hashRecoveryCode, base32Encode, base32Decode, STEP_SECONDS, DIGITS };
