"use strict";

const { BiometricAdapter } = require("./BiometricAdapter");
const { AppError } = require("../../../core/errors/AppError");
const { logger } = require("../../../config/logger");

/**
 * Generic REST adapter.
 *
 * Works with any device, middleware or cloud service that exposes attendance
 * logs as JSON over HTTP — which covers eSSL/ZKTeco cloud portals, Matrix
 * COSEC's web API, most Chinese OEM middleware, and any in-house bridge a
 * customer already runs on their LAN.
 *
 * The response shape is configured, not assumed: `fieldMap` says which JSON
 * keys hold the user id and the timestamp, so a new vendor is usually a
 * configuration change rather than a new adapter.
 */
class HttpApiAdapter extends BiometricAdapter {
  static get displayName() {
    return "HTTP / REST API";
  }

  static get capabilities() {
    return {
      fetchPunches: true,
      fetchUsers: true,
      pushUser: false,
      removeUser: false,
      deviceInfo: true,
      realtime: false,
    };
  }

  static get connectionFields() {
    return [
      { key: "baseUrl", label: "API base URL", type: "url", required: true, help: "e.g. https://device-portal.example.com/api" },
      { key: "username", label: "Username", type: "text", required: false },
      { key: "password", label: "Password", type: "password", required: false },
      { key: "apiKey", label: "API key", type: "password", required: false, help: "Sent as the Authorization header when set" },
      { key: "serialNumber", label: "Device serial number", type: "text", required: false },
      {
        key: "extra.punchesPath",
        label: "Attendance logs path",
        type: "text",
        required: false,
        help: "Default: /attendance. Supports {since} and {serial} placeholders.",
      },
      {
        key: "extra.fieldMap",
        label: "Field mapping",
        type: "json",
        required: false,
        help: 'Default: {"userId":"userId","timestamp":"punchTime","direction":"direction"}',
      },
    ];
  }

  get baseUrl() {
    const url = this.device.connection.baseUrl;
    if (!url) {
      throw new AppError("DEVICE_UNREACHABLE", {
        message: "This device has no API base URL configured.",
      });
    }
    return url.replace(/\/+$/, "");
  }

  get fieldMap() {
    return {
      userId: "userId",
      timestamp: "punchTime",
      direction: "direction",
      verifyMode: "verifyMode",
      ...((this.device.connection.extra && this.device.connection.extra.fieldMap) || {}),
    };
  }

  headers() {
    const headers = { Accept: "application/json" };
    const { apiKey, username, password } = this.device.connection;

    if (apiKey) {
      headers.Authorization = apiKey.startsWith("Bearer ") ? apiKey : `Bearer ${apiKey}`;
    } else if (username) {
      headers.Authorization = `Basic ${Buffer.from(`${username}:${password || ""}`).toString("base64")}`;
    }
    return headers;
  }

  async request(path, { method = "GET", body = null } = {}) {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const timeout = this.device.connection.timeoutMs || 15000;

    // A device on a slow VPN must not hold an API worker open indefinitely.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          ...this.headers(),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new AppError("DEVICE_UNREACHABLE", {
          message: `The device API returned ${response.status}.`,
          meta: { url, status: response.status, body: text.slice(0, 500) },
        });
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("json")) {
        const text = await response.text();
        throw new AppError("DEVICE_UNREACHABLE", {
          message: "The device API did not return JSON.",
          meta: { url, sample: text.slice(0, 200) },
        });
      }

      return response.json();
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (err.name === "AbortError") {
        throw new AppError("DEVICE_UNREACHABLE", {
          message: `The device did not respond within ${timeout / 1000} seconds.`,
        });
      }
      throw new AppError("DEVICE_UNREACHABLE", {
        message: `Could not reach the device: ${err.message}`,
        meta: { url },
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async testConnection() {
    const path =
      (this.device.connection.extra && this.device.connection.extra.infoPath) || "/info";
    try {
      const info = await this.request(path);
      return { ok: true, message: "Connected successfully.", info };
    } catch (err) {
      // Not every device exposes /info; a successful log fetch is proof enough.
      try {
        const since = new Date(Date.now() - 3600_000);
        await this.fetchPunches(since);
        return { ok: true, message: "Connected. The device has no info endpoint, but logs are readable." };
      } catch (inner) {
        return { ok: false, message: inner.message };
      }
    }
  }

  async fetchPunches(since) {
    const template =
      (this.device.connection.extra && this.device.connection.extra.punchesPath) || "/attendance";

    const path = template
      .replace("{since}", encodeURIComponent(since ? since.toISOString() : ""))
      .replace("{serial}", encodeURIComponent(this.device.connection.serialNumber || ""));

    const payload = await this.request(path);
    const rows = extractRows(payload);
    const map = this.fieldMap;

    const events = [];
    for (const row of rows) {
      const deviceUserId = pick(row, map.userId);
      const timestamp = pick(row, map.timestamp);
      if (!deviceUserId || !timestamp) continue;

      let occurredAt;
      try {
        occurredAt = this.toInstant(timestamp);
      } catch (err) {
        logger.warn({ err, row }, "Skipping a device row with an unreadable timestamp");
        continue;
      }

      // Belt and braces: the device may ignore the `since` parameter entirely.
      if (since && occurredAt <= since) continue;

      events.push({
        deviceUserId: String(deviceUserId),
        occurredAt,
        rawTimestamp: String(timestamp),
        direction: normaliseDirection(pick(row, map.direction)) || this.device.defaultDirection,
        verifyMode: pick(row, map.verifyMode) || null,
        raw: row,
      });
    }

    return events;
  }

  async fetchUsers() {
    const path =
      (this.device.connection.extra && this.device.connection.extra.usersPath) || "/users";
    const payload = await this.request(path);
    const map = this.fieldMap;

    return extractRows(payload).map((row) => ({
      deviceUserId: String(pick(row, map.userId) || pick(row, "id") || ""),
      name: pick(row, "name") || pick(row, "userName") || "",
      raw: row,
    }));
  }

  async getDeviceInfo() {
    const path =
      (this.device.connection.extra && this.device.connection.extra.infoPath) || "/info";
    return this.request(path);
  }
}

/** Devices wrap their arrays in every conceivable key. Find the list. */
function extractRows(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["data", "records", "logs", "result", "items", "attendance", "list"]) {
    if (Array.isArray(payload && payload[key])) return payload[key];
  }
  // One more level, for {data: {records: [...]}}
  if (payload && payload.data && typeof payload.data === "object") {
    for (const key of ["records", "logs", "items", "list"]) {
      if (Array.isArray(payload.data[key])) return payload.data[key];
    }
  }
  return [];
}

function pick(row, path) {
  if (!path) return undefined;
  return String(path)
    .split(".")
    .reduce((acc, key) => (acc === null || acc === undefined ? undefined : acc[key]), row);
}

function normaliseDirection(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).toLowerCase();
  if (["in", "0", "checkin", "check-in", "i", "entry"].includes(text)) return "in";
  if (["out", "1", "checkout", "check-out", "o", "exit"].includes(text)) return "out";
  return null;
}

module.exports = { HttpApiAdapter };
