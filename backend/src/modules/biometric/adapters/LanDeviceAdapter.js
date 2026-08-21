"use strict";

const { BiometricAdapter } = require("./BiometricAdapter");
const { AppError } = require("../../../core/errors/AppError");

/**
 * Direct LAN devices (ZKTeco / eSSL / Realtime and compatibles).
 *
 * These speak a proprietary binary protocol over UDP or TCP port 4370. Talking
 * to them correctly needs the vendor's SDK or a faithful protocol
 * implementation, and — more importantly — the API server has to be on the
 * same network as the device, which is not true of a cloud deployment.
 *
 * The honest architecture for that is a small on-premise bridge: it sits on
 * the customer's LAN, speaks the binary protocol to the device, and posts
 * events to this platform through the Webhook adapter or the HTTP adapter in
 * reverse. That keeps the protocol dependency out of the SaaS and out of this
 * codebase.
 *
 * This class therefore exists to (a) hold the connection fields such a bridge
 * needs so the device can still be configured and documented here, and (b)
 * fail loudly and specifically rather than pretending to sync. Wiring a real
 * SDK in later means implementing `fetchPunches` and `testConnection` on this
 * class alone — nothing else in the platform changes.
 */
class LanDeviceAdapter extends BiometricAdapter {
  static get displayName() {
    return "LAN device (ZKTeco / eSSL / Realtime)";
  }

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

  static get connectionFields() {
    return [
      { key: "host", label: "Device IP address", type: "text", required: true, help: "e.g. 192.168.1.201" },
      { key: "port", label: "Port", type: "number", required: false, help: "Usually 4370" },
      { key: "password", label: "Comm key", type: "password", required: false, help: "0 on most devices" },
      { key: "deviceNumber", label: "Machine number", type: "number", required: false },
      { key: "serialNumber", label: "Serial number", type: "text", required: false },
    ];
  }

  static get requiresBridge() {
    return true;
  }

  async testConnection() {
    return {
      ok: false,
      message:
        "Devices on a local network cannot be reached directly from the cloud. Install the Chefotech LAN bridge on a machine in the same network, or switch this device to Webhook or File import mode.",
      info: { requiresBridge: true, host: this.device.connection.host, port: this.device.connection.port || 4370 },
    };
  }

  async fetchPunches() {
    throw new AppError("DEVICE_UNREACHABLE", {
      message:
        "This device is configured for a direct LAN connection, which needs the Chefotech LAN bridge. Events pushed by the bridge are ingested through the webhook endpoint.",
      meta: { deviceCode: this.device.code, requiresBridge: true },
    });
  }
}

module.exports = { LanDeviceAdapter };
