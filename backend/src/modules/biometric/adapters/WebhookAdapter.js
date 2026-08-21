"use strict";

const crypto = require("node:crypto");
const { BiometricAdapter } = require("./BiometricAdapter");

/**
 * Push-based devices.
 *
 * Nothing is fetched: the device (or the vendor's cloud) posts to
 * `/api/v1/biometric/webhook/:deviceCode`, and the sync service ingests
 * whatever arrives. This is the right mode for hardware behind a customer's
 * NAT that we could never dial into from outside.
 *
 * Requests are authenticated by a per-device secret, compared in constant
 * time — an attendance webhook that anyone can post to is an attendance
 * system anyone can forge.
 */
class WebhookAdapter extends BiometricAdapter {
  static get displayName() {
    return "Webhook (device pushes to us)";
  }

  static get capabilities() {
    return {
      fetchPunches: false,
      fetchUsers: false,
      pushUser: false,
      removeUser: false,
      deviceInfo: false,
      realtime: true,
    };
  }

  static get connectionFields() {
    return [
      {
        key: "apiKey",
        label: "Webhook secret",
        type: "password",
        required: true,
        help: "The device must send this as the X-Device-Secret header.",
      },
      {
        key: "extra.fieldMap",
        label: "Field mapping",
        type: "json",
        required: false,
        help: 'Default: {"userId":"userId","timestamp":"timestamp","direction":"direction"}',
      },
    ];
  }

  async testConnection() {
    if (!this.device.connection.apiKey) {
      return { ok: false, message: "Set a webhook secret before this device can send data." };
    }
    return {
      ok: true,
      message: this.device.sync.lastEventAt
        ? `Last event received ${this.device.sync.lastEventAt.toISOString()}.`
        : "Ready. Waiting for the device to post its first event.",
    };
  }

  /** Pull is a no-op: everything arrives through the webhook route. */
  async fetchPunches() {
    return [];
  }

  static verifySecret(expected, supplied) {
    if (!expected || !supplied) return false;
    const a = Buffer.from(String(expected));
    const b = Buffer.from(String(supplied));
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  /** Normalise an inbound webhook body into the standard event shape. */
  normalisePayload(body) {
    const map = {
      userId: "userId",
      timestamp: "timestamp",
      direction: "direction",
      verifyMode: "verifyMode",
      ...((this.device.connection.extra && this.device.connection.extra.fieldMap) || {}),
    };

    const rows = Array.isArray(body)
      ? body
      : Array.isArray(body && body.events)
        ? body.events
        : Array.isArray(body && body.data)
          ? body.data
          : [body];

    const events = [];
    for (const row of rows) {
      const deviceUserId = row[map.userId];
      const timestamp = row[map.timestamp];
      if (!deviceUserId || !timestamp) continue;

      events.push({
        deviceUserId: String(deviceUserId),
        occurredAt: this.toInstant(timestamp),
        rawTimestamp: String(timestamp),
        direction: normaliseDirection(row[map.direction]) || this.device.defaultDirection,
        verifyMode: row[map.verifyMode] || null,
        raw: row,
      });
    }
    return events;
  }
}

function normaliseDirection(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).toLowerCase();
  if (["in", "0", "checkin", "check-in", "entry"].includes(text)) return "in";
  if (["out", "1", "checkout", "check-out", "exit"].includes(text)) return "out";
  return null;
}

module.exports = { WebhookAdapter };
