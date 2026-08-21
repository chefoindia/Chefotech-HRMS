"use strict";

const { AppError } = require("../../../core/errors/AppError");

/**
 * The biometric adapter interface.
 *
 * Every device integration implements this. The attendance engine, the sync
 * service and the UI all talk to this shape and never to a vendor SDK, so
 * supporting a new manufacturer is a new file in `adapters/` plus a registry
 * entry — no change to attendance processing, no change to the data model, no
 * `if (device.brand === "...")` anywhere.
 *
 * The contract deliberately separates FETCHING (read what the device recorded)
 * from PUSHING (write an employee onto the device). Many deployments only ever
 * need the first, and an adapter that cannot enrol users is still useful.
 */
class BiometricAdapter {
  /**
   * @param {object} device  the BiometricDevice document, with credentials
   * @param {object} context { timezone, logger }
   */
  constructor(device, context = {}) {
    this.device = device;
    this.timezone = context.timezone;
    this.logger = context.logger;
  }

  /** Human name shown in the device picker. */
  static get displayName() {
    return "Unnamed adapter";
  }

  /**
   * Which connection fields this adapter needs, so the UI can render the right
   * form instead of showing every field for every device.
   * @returns {Array<{key, label, type, required, help}>}
   */
  static get connectionFields() {
    return [];
  }

  /** Which capabilities this adapter actually implements. */
  static get capabilities() {
    return {
      fetchPunches: false,
      fetchUsers: false,
      pushUser: false,
      removeUser: false,
      deviceInfo: false,
      realtime: false,
    };
  }

  async connect() {
    return { connected: true };
  }

  async disconnect() {
    return { disconnected: true };
  }

  /**
   * Prove the configuration works, without importing anything.
   * @returns {Promise<{ok: boolean, message: string, info?: object}>}
   */
  async testConnection() {
    throw this.notImplemented("testConnection");
  }

  /**
   * Pull attendance events recorded at or after `since`.
   *
   * @param {Date|null} since
   * @returns {Promise<Array<{deviceUserId, occurredAt, direction, verifyMode, raw, rawTimestamp}>>}
   */
  async fetchPunches() {
    throw this.notImplemented("fetchPunches");
  }

  /** Enrolled users on the device, for mapping against employees. */
  async fetchUsers() {
    throw this.notImplemented("fetchUsers");
  }

  async pushUser() {
    throw this.notImplemented("pushUser");
  }

  async removeUser() {
    throw this.notImplemented("removeUser");
  }

  async getDeviceInfo() {
    throw this.notImplemented("getDeviceInfo");
  }

  /**
   * Convenience: connect, fetch, disconnect.
   * Adapters with a persistent session override this.
   */
  async sync(since) {
    await this.connect();
    try {
      return await this.fetchPunches(since);
    } finally {
      await this.disconnect().catch(() => {});
    }
  }

  notImplemented(method) {
    return new AppError("NOT_IMPLEMENTED", {
      message: `${this.constructor.displayName} does not support ${method}.`,
      meta: { adapter: this.constructor.name, method },
    });
  }

  /** Shared helper: turn a device-local timestamp into a real instant. */
  toInstant(localTimestamp) {
    const dt = require("../../../shared/datetime");
    if (localTimestamp instanceof Date) return localTimestamp;

    const text = String(localTimestamp).trim();

    // Already carries a zone or a Z suffix — trust it.
    if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(text)) return new Date(text);

    // Otherwise it is wall-clock time in the device's timezone.
    const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(text);
    if (match) {
      const [, y, m, d, hh, mm] = match;
      return dt.combine(`${y}-${m}-${d}`, `${hh}:${mm}`, this.timezone);
    }

    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return parsed;

    throw new AppError("DEVICE_UNREACHABLE", {
      message: `Could not understand the timestamp "${localTimestamp}" from this device.`,
    });
  }
}

module.exports = { BiometricAdapter };
