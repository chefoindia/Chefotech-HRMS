"use strict";

const crypto = require("node:crypto");
const { env } = require("../../config/env");

/**
 * Encryption at rest for tenant-supplied credentials — today that means one
 * thing: the Gemini API key an organization pastes into AI settings.
 *
 * A third-party API key is not like a password: it cannot be hashed, because
 * the whole point is that we send the original value back out to Google on
 * the tenant's behalf. So it has to be reversible, and it has to be encrypted
 * — a plaintext API key sitting in a MongoDB collection is one leaked backup
 * away from every tenant's Gemini quota being someone else's to spend.
 *
 * AES-256-GCM: authenticated encryption, so a tampered ciphertext fails to
 * decrypt rather than silently returning garbage that gets sent to Google as
 * a bearer credential.
 */

const ALGORITHM = "aes-256-gcm";

function masterKey() {
  const configured = env.security.credentialEncryptionKey;
  if (!configured) {
    throw new Error(
      "AI_CREDENTIAL_ENCRYPTION_KEY is not set. Generate one with " +
        '`node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"` ' +
        "and set it before any tenant credential can be stored or read."
    );
  }
  const key = Buffer.from(configured, "hex");
  if (key.length !== 32) {
    throw new Error("AI_CREDENTIAL_ENCRYPTION_KEY must be 32 bytes, hex-encoded (64 characters).");
  }
  return key;
}

/** Encrypt a string. Returns the three GCM parts, each already base64. */
function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

/** The inverse of encrypt(). Throws if the key is wrong or the data was altered. */
function decrypt({ ciphertext, iv, authTag }) {
  const decipher = crypto.createDecipheriv(ALGORITHM, masterKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

/**
 * For display only: never enough characters to reconstruct or narrow down
 * the real key, but enough that an admin can recognise which key is saved.
 */
function mask(plaintext) {
  const value = String(plaintext || "");
  if (value.length <= 8) return "•".repeat(Math.max(value.length, 4));
  return `${value.slice(0, 4)}${"•".repeat(8)}${value.slice(-4)}`;
}

module.exports = { encrypt, decrypt, mask };
