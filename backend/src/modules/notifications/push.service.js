"use strict";

const DeviceToken = require("./deviceToken.model");
const { env } = require("../../config/env");
const { logger } = require("../../config/logger");
const { AppError } = require("../../core/errors/AppError");

/**
 * Push delivery, over two transports.
 *
 *   Expo push  — the mobile app. Expo's service fronts APNs and FCM, so the
 *                backend needs no Apple or Google credentials of its own; an
 *                optional access token raises the rate limits.
 *   Web push   — the browser, via the standard Push API and VAPID keys. Works
 *                on desktop Chrome/Edge/Firefox and on Android; iOS Safari
 *                only when the site is installed to the home screen.
 *
 * Both are loaded lazily so a deployment that never uses push does not pay
 * for the SDKs at boot, and so a missing VAPID key degrades to "web push not
 * configured" rather than a crash on require.
 */

const MAX_DEVICES_PER_USER = 10;
const RECEIPT_MIN_AGE_MS = 15 * 60 * 1000;

let expoClient = null;
let webPushReady = false;

function getExpo() {
  if (expoClient) return expoClient;
  const { Expo } = require("expo-server-sdk");
  expoClient = new Expo(env.push.expoAccessToken ? { accessToken: env.push.expoAccessToken } : {});
  return expoClient;
}

function isExpoToken(token) {
  const { Expo } = require("expo-server-sdk");
  return Expo.isExpoPushToken(token);
}

function webPushConfigured() {
  return Boolean(env.push.vapidPublicKey && env.push.vapidPrivateKey);
}

function getWebPush() {
  if (!webPushConfigured()) return null;
  const webpush = require("web-push");
  if (!webPushReady) {
    webpush.setVapidDetails(env.push.vapidSubject, env.push.vapidPublicKey, env.push.vapidPrivateKey);
    webPushReady = true;
  }
  return webpush;
}

/** What the clients need to know before registering. */
function config() {
  return {
    expo: true,
    web: webPushConfigured(),
    vapidPublicKey: webPushConfigured() ? env.push.vapidPublicKey : null,
  };
}

// ── Registration ────────────────────────────────────────────────────────────

async function register(userId, { kind, token, subscription, platform, deviceName, appVersion, userAgent }) {
  if (kind === "expo") {
    if (!token || !isExpoToken(token)) {
      throw AppError.badRequest("That is not a valid Expo push token.");
    }
  } else if (kind === "web") {
    if (!subscription || !subscription.endpoint || !subscription.keys || !subscription.keys.p256dh) {
      throw AppError.badRequest("A web push registration needs the browser subscription object.");
    }
    if (!webPushConfigured()) {
      throw new AppError("NOT_IMPLEMENTED", {
        message: "Web push is not configured on this server (VAPID keys are missing).",
      });
    }
    token = subscription.endpoint;
  } else {
    throw AppError.badRequest("Unknown device kind.");
  }

  // The same physical device re-registering (app reinstall, new session) must
  // update the row it already has — including moving it to a different user
  // if someone else signed in on the same phone.
  const device = await DeviceToken.findOneAndUpdate(
    { token },
    {
      $set: {
        userId,
        kind,
        token,
        subscription: kind === "web" ? subscription : { endpoint: null, keys: {} },
        platform: platform || (kind === "web" ? "web" : "unknown"),
        deviceName: deviceName || "",
        appVersion: appVersion || "",
        userAgent: (userAgent || "").slice(0, 300),
        lastSeenAt: new Date(),
        failures: 0,
        disabledAt: null,
        disabledReason: null,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  // Keep the newest N per user; a phone that was replaced three times should
  // not leave three dead tokens receiving nothing.
  const all = await DeviceToken.find({ userId }).sort({ lastSeenAt: -1 }).select("_id").lean();
  if (all.length > MAX_DEVICES_PER_USER) {
    await DeviceToken.deleteMany({ _id: { $in: all.slice(MAX_DEVICES_PER_USER).map((d) => d._id) } });
  }

  return shape(device);
}

async function unregister(userId, token) {
  const result = await DeviceToken.deleteOne({ userId, token });
  return { removed: result.deletedCount > 0 };
}

async function listForUser(userId) {
  const devices = await DeviceToken.find({ userId }).sort({ lastSeenAt: -1 }).lean();
  return devices.map(shape);
}

async function hasActiveDevice(userId) {
  return Boolean(await DeviceToken.exists({ userId, disabledAt: null }));
}

function shape(device) {
  return {
    id: String(device._id),
    kind: device.kind,
    platform: device.platform,
    deviceName: device.deviceName,
    appVersion: device.appVersion,
    lastSeenAt: device.lastSeenAt,
    lastDeliveredAt: device.lastDeliveredAt,
    isActive: !device.disabledAt,
    disabledReason: device.disabledReason,
  };
}

// ── Sending ─────────────────────────────────────────────────────────────────

/**
 * Push one message to every active device a user has.
 *
 * @param {string} userId
 * @param {{title: string, body: string, data?: object, badge?: number, channelId?: string}} message
 * @returns {Promise<{attempted: number, delivered: number, failed: number, noDevices?: boolean}>}
 */
async function sendToUser(userId, message) {
  const devices = await DeviceToken.find({ userId, disabledAt: null }).lean();
  if (!devices.length) return { attempted: 0, delivered: 0, failed: 0, noDevices: true };

  const outcome = { attempted: devices.length, delivered: 0, failed: 0 };
  const expoDevices = devices.filter((d) => d.kind === "expo");
  const webDevices = devices.filter((d) => d.kind === "web");

  if (expoDevices.length) {
    const result = await sendExpo(expoDevices, message);
    outcome.delivered += result.delivered;
    outcome.failed += result.failed;
  }
  if (webDevices.length) {
    const result = await sendWeb(webDevices, message);
    outcome.delivered += result.delivered;
    outcome.failed += result.failed;
  }
  return outcome;
}

async function sendExpo(devices, message) {
  const expo = getExpo();
  const messages = devices.map((device) => ({
    to: device.token,
    title: message.title,
    body: message.body,
    data: message.data || {},
    sound: "default",
    badge: message.badge,
    channelId: message.channelId || "default",
    priority: "high",
  }));

  let delivered = 0;
  let failed = 0;
  const byToken = Object.fromEntries(devices.map((d) => [d.token, d]));

  for (const chunk of expo.chunkPushNotifications(messages)) {
    let tickets;
    try {
      tickets = await expo.sendPushNotificationsAsync(chunk);
    } catch (err) {
      logger.error({ err }, "Expo push send failed for a whole chunk");
      failed += chunk.length;
      continue;
    }

    for (let i = 0; i < tickets.length; i += 1) {
      const ticket = tickets[i];
      const device = byToken[chunk[i].to];
      if (!device) continue;

      if (ticket.status === "ok") {
        delivered += 1;
        await DeviceToken.updateOne(
          { _id: device._id },
          {
            $set: { lastDeliveredAt: new Date(), failures: 0 },
            $push: { pendingTickets: { $each: [{ id: ticket.id, at: new Date() }], $slice: -50 } },
          }
        );
      } else {
        failed += 1;
        const code = ticket.details && ticket.details.error;
        await recordFailure(device, code || ticket.message);
      }
    }
  }

  return { delivered, failed };
}

async function sendWeb(devices, message) {
  const webpush = getWebPush();
  if (!webpush) return { delivered: 0, failed: devices.length };

  const payload = JSON.stringify({
    title: message.title,
    body: message.body,
    data: message.data || {},
    icon: message.icon || undefined,
  });

  let delivered = 0;
  let failed = 0;

  await Promise.all(
    devices.map(async (device) => {
      try {
        await webpush.sendNotification(device.subscription, payload, { TTL: 3600 });
        delivered += 1;
        await DeviceToken.updateOne(
          { _id: device._id },
          { $set: { lastDeliveredAt: new Date(), failures: 0 } }
        );
      } catch (err) {
        failed += 1;
        // 404 and 410 mean the browser unsubscribed; the endpoint is dead.
        const gone = err && (err.statusCode === 404 || err.statusCode === 410);
        await recordFailure(device, gone ? "DeviceNotRegistered" : (err && err.message) || "unknown");
      }
    })
  );

  return { delivered, failed };
}

async function recordFailure(device, reason) {
  const permanent = ["DeviceNotRegistered", "InvalidCredentials", "MismatchSenderId"].includes(reason);
  const failures = (device.failures || 0) + 1;
  const disable = permanent || failures >= 5;

  await DeviceToken.updateOne(
    { _id: device._id },
    {
      $set: {
        failures,
        ...(disable ? { disabledAt: new Date(), disabledReason: String(reason).slice(0, 120) } : {}),
      },
    }
  );
  if (disable) logger.info({ device: String(device._id), reason }, "Push device retired");
}

/**
 * Collect Expo receipts for tickets old enough to have one, and retire tokens
 * the OS has told Expo are gone. Runs from a schedule; global, not per tenant.
 */
async function checkReceipts() {
  const expo = getExpo();
  const cutoff = new Date(Date.now() - RECEIPT_MIN_AGE_MS);

  const devices = await DeviceToken.find({ kind: "expo", "pendingTickets.at": { $lt: cutoff } })
    .select("_id pendingTickets")
    .limit(500)
    .lean();

  if (!devices.length) return { checked: 0, retired: 0 };

  const ticketOwner = new Map();
  for (const device of devices) {
    for (const ticket of device.pendingTickets || []) {
      if (ticket.at < cutoff && ticket.id) ticketOwner.set(ticket.id, device._id);
    }
  }

  const ids = [...ticketOwner.keys()];
  let retired = 0;

  for (const chunk of expo.chunkPushNotificationReceiptIds(ids)) {
    let receipts;
    try {
      receipts = await expo.getPushNotificationReceiptsAsync(chunk);
    } catch (err) {
      logger.warn({ err }, "Could not fetch push receipts");
      continue;
    }

    for (const [id, receipt] of Object.entries(receipts)) {
      const deviceId = ticketOwner.get(id);
      if (!deviceId) continue;
      if (receipt.status === "error") {
        const code = receipt.details && receipt.details.error;
        if (code === "DeviceNotRegistered") {
          await DeviceToken.updateOne(
            { _id: deviceId },
            { $set: { disabledAt: new Date(), disabledReason: code } }
          );
          retired += 1;
        } else {
          logger.warn({ deviceId: String(deviceId), code, message: receipt.message }, "Push receipt reported an error");
        }
      }
    }
  }

  // Whether or not a receipt came back, these tickets have been dealt with.
  await DeviceToken.updateMany(
    { _id: { $in: devices.map((d) => d._id) } },
    { $pull: { pendingTickets: { id: { $in: ids } } } }
  );

  return { checked: ids.length, retired };
}

module.exports = {
  config,
  register,
  unregister,
  listForUser,
  hasActiveDevice,
  sendToUser,
  checkReceipts,
  webPushConfigured,
  DeviceToken,
};
