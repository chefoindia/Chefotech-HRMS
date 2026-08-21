"use strict";

const { BiometricAdapter } = require("./BiometricAdapter");
const { HttpApiAdapter } = require("./HttpApiAdapter");
const { WebhookAdapter } = require("./WebhookAdapter");
const { FileImportAdapter } = require("./FileImportAdapter");
const { LanDeviceAdapter } = require("./LanDeviceAdapter");
const { AppError } = require("../../../core/errors/AppError");

/**
 * The adapter registry.
 *
 * Providers are looked up by key at runtime. A customer-specific integration
 * can be registered at boot with `register()` without editing this file, and
 * nothing outside `adapters/` needs to know it exists.
 */
const registry = new Map();

function register(key, AdapterClass, meta = {}) {
  if (!(AdapterClass.prototype instanceof BiometricAdapter)) {
    throw new Error(`${AdapterClass.name} must extend BiometricAdapter`);
  }
  registry.set(key, { key, AdapterClass, ...meta });
}

register("http", HttpApiAdapter, {
  mode: "http",
  description: "Any device, middleware or cloud portal that exposes attendance logs as JSON.",
  recommended: true,
});
register("webhook", WebhookAdapter, {
  mode: "webhook",
  description: "The device or a local bridge posts events to Chefotech as they happen.",
  recommended: true,
});
register("file", FileImportAdapter, {
  mode: "file",
  description: "Upload the log file exported from the device's own software.",
  recommended: true,
});
register("lan", LanDeviceAdapter, {
  mode: "lan",
  description:
    "Direct connection to a device on the local network. Requires the Chefotech LAN bridge.",
  requiresBridge: true,
});

function createAdapter(device, context = {}) {
  const entry = registry.get(device.provider);
  if (!entry) {
    throw AppError.badRequest(
      `No integration is registered for '${device.provider}'.`,
      { available: [...registry.keys()] }
    );
  }
  return new entry.AdapterClass(device, context);
}

/** Catalog for the "add a device" screen. */
function listProviders() {
  return [...registry.values()].map((entry) => ({
    key: entry.key,
    name: entry.AdapterClass.displayName,
    description: entry.description || "",
    mode: entry.mode || "http",
    capabilities: entry.AdapterClass.capabilities,
    connectionFields: entry.AdapterClass.connectionFields,
    requiresBridge: Boolean(entry.requiresBridge),
    recommended: Boolean(entry.recommended),
  }));
}

module.exports = { register, createAdapter, listProviders, registry, BiometricAdapter };
