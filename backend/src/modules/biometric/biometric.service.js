"use strict";

const BiometricDevice = require("./biometricDevice.model");
const { BiometricEvent, BiometricSyncLog } = require("./biometricEvent.model");
const { createAdapter } = require("./adapters");
const Employee = require("../employees/employee.model");
const Location = require("../locations/location.model");
const Organization = require("../organizations/organization.model");
const attendanceService = require("../attendance/attendance.service");
const { assertLimit } = require("../organizations/planGuard");
const { AppError } = require("../../core/errors/AppError");
const audit = require("../../core/audit/audit.service");
const tenant = require("../../core/tenancy/tenantContext");
const { logger } = require("../../config/logger");
const dt = require("../../shared/datetime");

/**
 * Biometric sync.
 *
 * The pipeline is deliberately staged, and each stage is separately
 * re-runnable:
 *
 *   adapter.fetchPunches()   what the device said
 *     → BiometricEvent       stored raw, immutable, deduplicated
 *       → employee mapping   device id → Employee.biometricId
 *         → Punch            interpreted, deduplicated again
 *           → processDay()   attendance recomputed for the affected days
 *
 * An event whose device id matches no employee is stored as `unmapped` rather
 * than discarded. When someone fixes the enrolment id a week later,
 * `reprocessUnmapped` turns those events into real attendance — the data was
 * never lost.
 */

async function deviceTimezone(device) {
  if (device.timezone) return device.timezone;
  if (device.locationId) {
    const location = await Location.findById(device.locationId).select("timezone").lean();
    if (location && location.timezone) return location.timezone;
  }
  return attendanceService.organizationTimezone();
}

async function adapterFor(deviceId) {
  // Credentials are select:false, so they must be asked for explicitly.
  const device = await BiometricDevice.findById(deviceId).select(
    "+connection.password +connection.apiKey"
  );
  if (!device) throw AppError.notFound("Device");

  const timezone = await deviceTimezone(device);
  return { device, adapter: createAdapter(device, { timezone, logger }) };
}

// ── Device management ───────────────────────────────────────────────────────

async function listDevices(query = {}) {
  const filter = {};
  if (query.isActive !== undefined) filter.isActive = query.isActive !== "false";
  if (query.locationId) filter.locationId = query.locationId;

  const devices = await BiometricDevice.find(filter)
    .populate("locationId", "name code")
    .sort({ name: 1 })
    .lean();

  return devices.map(shapeDevice);
}

/** Credentials never leave the server, in any response. */
function shapeDevice(device) {
  const connection = { ...(device.connection || {}) };
  delete connection.password;
  delete connection.apiKey;
  return {
    ...device,
    id: String(device._id),
    connection: {
      ...connection,
      hasPassword: Boolean((device.connection || {}).password),
      hasApiKey: Boolean((device.connection || {}).apiKey),
    },
  };
}

async function createDevice(data, req) {
  const organization = await tenant.runAsSystem(
    () => Organization.findById(tenant.requireOrganizationId()).lean(),
    "biometric.create"
  );
  const existing = await BiometricDevice.countDocuments({ isActive: true });
  assertLimit(organization, "biometricDevices", existing, 1);

  const device = await BiometricDevice.create({ ...data, createdBy: tenant.getUserId() });

  await audit.record(
    {
      action: "biometric.device_created",
      entityType: "BiometricDevice",
      entityId: device._id,
      entityLabel: device.name,
      // The credentials are stripped by the audit service, but be explicit.
      after: { name: device.name, code: device.code, provider: device.provider, mode: device.mode },
      severity: "warning",
    },
    req
  );

  return shapeDevice(device.toObject());
}

async function updateDevice(deviceId, data, req) {
  const device = await BiometricDevice.findById(deviceId);
  if (!device) throw AppError.notFound("Device");

  const before = {
    name: device.name,
    provider: device.provider,
    mode: device.mode,
    connection: { host: device.connection.host, baseUrl: device.connection.baseUrl },
    sync: { enabled: device.sync.enabled, intervalMinutes: device.sync.intervalMinutes },
  };

  // A blank credential in a PATCH means "leave it alone", not "clear it" —
  // otherwise every save from a UI that cannot display the secret wipes it.
  if (data.connection) {
    const { password, apiKey, ...rest } = data.connection;
    Object.assign(device.connection, rest);
    if (password) device.connection.password = password;
    if (apiKey) device.connection.apiKey = apiKey;
    delete data.connection;
  }

  Object.assign(device, data, { updatedBy: tenant.getUserId() });
  await device.save();

  await audit.record(
    {
      action: "biometric.device_updated",
      entityType: "BiometricDevice",
      entityId: device._id,
      entityLabel: device.name,
      before,
      after: {
        name: device.name,
        provider: device.provider,
        mode: device.mode,
        connection: { host: device.connection.host, baseUrl: device.connection.baseUrl },
        sync: { enabled: device.sync.enabled, intervalMinutes: device.sync.intervalMinutes },
      },
      severity: "warning",
      skipIfUnchanged: true,
    },
    req
  );

  return shapeDevice(device.toObject());
}

async function deleteDevice(deviceId, req) {
  const device = await BiometricDevice.findById(deviceId);
  if (!device) throw AppError.notFound("Device");

  // Raw events survive: they are the evidence behind past attendance.
  device.isActive = false;
  device.sync.enabled = false;
  await device.save();
  await device.softDelete(tenant.getUserId());

  await audit.record(
    {
      action: "biometric.device_removed",
      entityType: "BiometricDevice",
      entityId: device._id,
      entityLabel: device.name,
      severity: "warning",
      description: "Device deactivated; its recorded events were retained",
    },
    req
  );

  return { id: String(device._id), removed: true };
}

async function testConnection(deviceId) {
  const { device, adapter } = await adapterFor(deviceId);

  const result = await adapter.testConnection().catch((err) => ({
    ok: false,
    message: err.message,
  }));

  device.status = result.ok ? "online" : "error";
  device.lastSeenAt = result.ok ? new Date() : device.lastSeenAt;
  if (!result.ok) device.sync.lastError = result.message;
  await device.save();

  return result;
}

// ── Sync ────────────────────────────────────────────────────────────────────

/**
 * Pull from a device and run the full pipeline.
 * Safe to call repeatedly: every stage deduplicates.
 */
async function syncDevice(deviceId, { trigger = "manual", req } = {}) {
  const { device, adapter } = await adapterFor(deviceId);

  const log = await BiometricSyncLog.create({
    deviceId: device._id,
    trigger,
    startedAt: new Date(),
    status: "running",
    triggeredBy: tenant.getUserId(),
  });

  const startedAt = Date.now();

  try {
    // Re-fetch a little before the watermark: devices with a drifting clock
    // otherwise drop events that land just behind the last one we saw.
    const since = device.sync.lastEventAt
      ? new Date(device.sync.lastEventAt.getTime() - 5 * 60 * 1000)
      : new Date(Date.now() - 7 * 86400000);

    const events = await adapter.sync(since);
    const result = await ingestEvents(device, events, { syncLogId: log._id, req });

    device.sync.lastSyncAt = new Date();
    device.sync.lastSyncStatus = result.unmapped > 0 ? "partial" : "success";
    device.sync.lastError = null;
    device.sync.consecutiveFailures = 0;
    if (result.latestEventAt) device.sync.lastEventAt = result.latestEventAt;
    device.status = "online";
    device.lastSeenAt = new Date();
    await device.save();

    Object.assign(log, {
      finishedAt: new Date(),
      durationMs: Date.now() - startedAt,
      status: result.unmapped > 0 ? "partial" : "success",
      eventsFetched: events.length,
      eventsNew: result.created,
      eventsDuplicate: result.duplicates,
      eventsUnmapped: result.unmapped,
      punchesCreated: result.punches,
      daysReprocessed: result.daysReprocessed,
      unmappedDeviceUserIds: result.unmappedIds,
    });
    await log.save();

    logger.info(
      { device: device.code, fetched: events.length, created: result.created, punches: result.punches },
      "Biometric sync complete"
    );

    return { ...result, fetched: events.length, syncLogId: String(log._id) };
  } catch (err) {
    device.sync.lastSyncAt = new Date();
    device.sync.lastSyncStatus = "failed";
    device.sync.lastError = err.message;
    device.sync.consecutiveFailures = (device.sync.consecutiveFailures || 0) + 1;
    device.status = "error";
    await device.save();

    Object.assign(log, {
      finishedAt: new Date(),
      durationMs: Date.now() - startedAt,
      status: "failed",
      error: err.message,
    });
    await log.save();

    logger.error({ err, device: device.code }, "Biometric sync failed");
    throw err;
  }
}

/**
 * Store raw events, map them to employees, create punches, recompute days.
 * @returns {Promise<object>} counters
 */
async function ingestEvents(device, events, { syncLogId = null, req } = {}) {
  const counters = {
    created: 0,
    duplicates: 0,
    unmapped: 0,
    punches: 0,
    daysReprocessed: 0,
    unmappedIds: [],
    latestEventAt: null,
  };

  if (!events.length) return counters;

  const timezone = await deviceTimezone(device);

  // One query resolves every device id in the batch.
  const deviceUserIds = [...new Set(events.map((e) => String(e.deviceUserId)))];
  const employees = await Employee.find({
    $or: [
      { biometricId: { $in: deviceUserIds } },
      { employeeCode: { $in: deviceUserIds } },
    ],
  })
    .select("employeeCode biometricId status")
    .lean();

  const byDeviceId = {};
  for (const employee of employees) {
    // biometricId wins: it is the id the device actually knows. Falling back
    // to employeeCode is a convenience for organizations that keep them in
    // sync, not an assumption that they are the same thing.
    if (employee.biometricId) byDeviceId[String(employee.biometricId)] = employee;
  }
  for (const employee of employees) {
    if (!byDeviceId[String(employee.employeeCode)]) {
      byDeviceId[String(employee.employeeCode)] = employee;
    }
  }

  const affected = new Map(); // `${employeeId}:${date}` -> { employeeId, date }
  const unmappedSet = new Set();

  for (const event of events) {
    const occurredAt = event.occurredAt instanceof Date ? event.occurredAt : new Date(event.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) continue;

    if (!counters.latestEventAt || occurredAt > counters.latestEventAt) {
      counters.latestEventAt = occurredAt;
    }

    const employee = byDeviceId[String(event.deviceUserId)];

    let raw;
    try {
      raw = await BiometricEvent.create({
        deviceId: device._id,
        deviceUserId: String(event.deviceUserId),
        occurredAt,
        rawTimestamp: event.rawTimestamp || null,
        direction: event.direction || null,
        verifyMode: event.verifyMode || null,
        raw: event.raw || null,
        processingStatus: employee ? "pending" : "unmapped",
        employeeId: employee ? employee._id : null,
        syncLogId,
      });
      counters.created += 1;
    } catch (err) {
      // The unique index is doing its job: the device re-sent an event.
      if (err.code === 11000) {
        counters.duplicates += 1;
        continue;
      }
      throw err;
    }

    if (!employee) {
      counters.unmapped += 1;
      unmappedSet.add(String(event.deviceUserId));
      continue;
    }

    if (!["active", "on_leave", "notice_period", "suspended"].includes(employee.status)) {
      await BiometricEvent.updateOne(
        { _id: raw._id },
        { $set: { processingStatus: "ignored", processedAt: new Date(), processingError: `Employee is ${employee.status}` } }
      );
      continue;
    }

    try {
      const { punch, duplicate } = await attendanceService.recordPunch(
        {
          employeeId: employee._id,
          at: occurredAt,
          direction: event.direction || device.defaultDirection,
          source: "biometric",
          deviceId: device._id,
          rawEventId: raw._id,
        },
        req
      );

      await BiometricEvent.updateOne(
        { _id: raw._id },
        {
          $set: {
            processingStatus: duplicate ? "duplicate" : "mapped",
            punchId: punch ? punch._id : null,
            processedAt: new Date(),
          },
        }
      );

      if (!duplicate) {
        counters.punches += 1;
        const date = dt.toDateString(occurredAt, timezone);
        affected.set(`${employee._id}:${date}`, { employeeId: employee._id, date });
      }
    } catch (err) {
      await BiometricEvent.updateOne(
        { _id: raw._id },
        { $set: { processingStatus: "error", processingError: err.message, processedAt: new Date() } }
      );
      logger.error({ err, eventId: String(raw._id) }, "Could not turn a biometric event into a punch");
    }
  }

  counters.unmappedIds = [...unmappedSet];
  counters.daysReprocessed = affected.size;

  // recordPunch already recomputed each day; the count is reported so the sync
  // log shows how much attendance actually moved.
  return counters;
}

/** Sync every device that is due. Called by the scheduler. */
async function syncDueDevices() {
  const devices = await BiometricDevice.find({ isActive: true, "sync.enabled": true }).lean();
  const now = Date.now();
  const results = [];

  for (const device of devices) {
    const interval = (device.sync.intervalMinutes || 15) * 60000;
    const last = device.sync.lastSyncAt ? device.sync.lastSyncAt.getTime() : 0;

    // Back off a device that keeps failing rather than hammering it every
    // interval and filling the log with the same error.
    const failures = device.sync.consecutiveFailures || 0;
    const backoff = failures > 3 ? Math.min(failures, 12) * interval : 0;

    if (now - last < interval + backoff) continue;

    try {
      const result = await syncDevice(device._id, { trigger: "scheduled" });
      results.push({ device: device.code, ok: true, ...result });
    } catch (err) {
      results.push({ device: device.code, ok: false, error: err.message });
    }
  }

  return results;
}

/**
 * Retry events whose device id matched no employee.
 * Run this after fixing an enrolment id — the attendance appears retroactively.
 */
async function reprocessUnmapped({ deviceId = null, fromDate = null } = {}, req) {
  const filter = { processingStatus: "unmapped" };
  if (deviceId) filter.deviceId = deviceId;
  if (fromDate) filter.occurredAt = { $gte: new Date(`${fromDate}T00:00:00.000Z`) };

  const events = await BiometricEvent.find(filter).sort({ occurredAt: 1 }).limit(10000).lean();
  if (!events.length) return { reprocessed: 0, stillUnmapped: 0 };

  const byDevice = {};
  for (const event of events) {
    const key = String(event.deviceId);
    (byDevice[key] = byDevice[key] || []).push(event);
  }

  let reprocessed = 0;
  let stillUnmapped = 0;

  for (const [id, deviceEvents] of Object.entries(byDevice)) {
    const device = await BiometricDevice.findById(id).lean();
    if (!device) continue;

    const deviceUserIds = [...new Set(deviceEvents.map((e) => e.deviceUserId))];
    const employees = await Employee.find({
      $or: [{ biometricId: { $in: deviceUserIds } }, { employeeCode: { $in: deviceUserIds } }],
    })
      .select("employeeCode biometricId status")
      .lean();

    const byDeviceId = {};
    for (const e of employees) {
      if (e.biometricId) byDeviceId[String(e.biometricId)] = e;
      if (!byDeviceId[String(e.employeeCode)]) byDeviceId[String(e.employeeCode)] = e;
    }

    for (const event of deviceEvents) {
      const employee = byDeviceId[String(event.deviceUserId)];
      if (!employee) {
        stillUnmapped += 1;
        continue;
      }

      try {
        const { punch } = await attendanceService.recordPunch(
          {
            employeeId: employee._id,
            at: event.occurredAt,
            direction: event.direction || device.defaultDirection,
            source: "biometric",
            deviceId: device._id,
            rawEventId: event._id,
          },
          req
        );
        await BiometricEvent.updateOne(
          { _id: event._id },
          {
            $set: {
              processingStatus: "mapped",
              employeeId: employee._id,
              punchId: punch ? punch._id : null,
              processedAt: new Date(),
            },
          }
        );
        reprocessed += 1;
      } catch (err) {
        logger.warn({ err, eventId: String(event._id) }, "Reprocessing an unmapped event failed");
      }
    }
  }

  await audit.record(
    {
      action: "biometric.events_reprocessed",
      entityType: "BiometricEvent",
      entityLabel: `${reprocessed} events`,
      after: { reprocessed, stillUnmapped },
      severity: "notice",
    },
    req
  );

  return { reprocessed, stillUnmapped };
}

/** Device ids seen by a device that match no employee — the fix-it list. */
async function unmappedSummary(deviceId = null) {
  const match = { processingStatus: "unmapped" };
  if (deviceId) match.deviceId = deviceId;

  return BiometricEvent.aggregate([
    { $match: match },
    {
      $group: {
        _id: { deviceId: "$deviceId", deviceUserId: "$deviceUserId" },
        count: { $sum: 1 },
        firstSeen: { $min: "$occurredAt" },
        lastSeen: { $max: "$occurredAt" },
      },
    },
    { $sort: { count: -1 } },
    { $limit: 200 },
    {
      $project: {
        _id: 0,
        deviceId: "$_id.deviceId",
        deviceUserId: "$_id.deviceUserId",
        count: 1,
        firstSeen: 1,
        lastSeen: 1,
      },
    },
  ]);
}

async function listEvents(query = {}) {
  const filter = {};
  if (query.deviceId) filter.deviceId = query.deviceId;
  if (query.employeeId) filter.employeeId = query.employeeId;
  if (query.status) filter.processingStatus = query.status;
  if (query.fromDate || query.toDate) {
    filter.occurredAt = {};
    if (query.fromDate) filter.occurredAt.$gte = new Date(`${query.fromDate}T00:00:00.000Z`);
    if (query.toDate) filter.occurredAt.$lte = new Date(`${query.toDate}T23:59:59.999Z`);
  }

  const limit = Math.min(Number(query.limit) || 100, 500);
  const [items, total] = await Promise.all([
    BiometricEvent.find(filter)
      .populate([
        { path: "deviceId", select: "name code" },
        { path: "employeeId", select: "employeeCode personal.firstName personal.lastName" },
      ])
      .sort({ occurredAt: -1 })
      .limit(limit)
      .lean(),
    BiometricEvent.countDocuments(filter),
  ]);

  return { items, total, limit };
}

async function listSyncLogs(deviceId, limit = 50) {
  const filter = deviceId ? { deviceId } : {};
  return BiometricSyncLog.find(filter)
    .populate("deviceId", "name code")
    .sort({ startedAt: -1 })
    .limit(Math.min(limit, 200))
    .lean();
}

/** Ingest an uploaded device log file. */
async function importFile(deviceId, file, req) {
  const { device, adapter } = await adapterFor(deviceId);

  if (typeof adapter.parseFile !== "function") {
    throw AppError.badRequest(
      `${adapter.constructor.displayName} does not support file import. Switch the device to File import mode.`
    );
  }

  const log = await BiometricSyncLog.create({
    deviceId: device._id,
    trigger: "import",
    status: "running",
    triggeredBy: tenant.getUserId(),
  });

  const startedAt = Date.now();
  const { events, skipped } = await adapter.parseFile(file);
  const result = await ingestEvents(device, events, { syncLogId: log._id, req });

  Object.assign(log, {
    finishedAt: new Date(),
    durationMs: Date.now() - startedAt,
    status: result.unmapped > 0 || skipped.length ? "partial" : "success",
    eventsFetched: events.length,
    eventsNew: result.created,
    eventsDuplicate: result.duplicates,
    eventsUnmapped: result.unmapped,
    punchesCreated: result.punches,
    unmappedDeviceUserIds: result.unmappedIds,
  });
  await log.save();

  if (result.latestEventAt && (!device.sync.lastEventAt || result.latestEventAt > device.sync.lastEventAt)) {
    device.sync.lastEventAt = result.latestEventAt;
    await device.save();
  }

  await audit.record(
    {
      action: "biometric.file_imported",
      entityType: "BiometricDevice",
      entityId: device._id,
      entityLabel: device.name,
      after: { rows: events.length, created: result.created, punches: result.punches, skipped: skipped.length },
      severity: "notice",
    },
    req
  );

  return { ...result, parsed: events.length, skipped, syncLogId: String(log._id) };
}

/** Handle an inbound webhook from a device or an on-premise bridge. */
async function ingestWebhook(deviceCode, body, secret, req) {
  const device = await BiometricDevice.findOne({ code: deviceCode.toUpperCase() }).select(
    "+connection.apiKey +connection.password"
  );
  if (!device || !device.isActive) throw AppError.notFound("Device");

  const { WebhookAdapter } = require("./adapters/WebhookAdapter");
  if (!WebhookAdapter.verifySecret(device.connection.apiKey, secret)) {
    // Deliberately vague: a caller with the wrong secret learns nothing about
    // whether the device code was right.
    throw new AppError("UNAUTHENTICATED", { message: "Invalid device credentials." });
  }

  const timezone = await deviceTimezone(device);
  const adapter = new WebhookAdapter(device, { timezone, logger });
  const events = adapter.normalisePayload(body);

  const result = await ingestEvents(device, events, { req });

  device.sync.lastSyncAt = new Date();
  device.sync.lastSyncStatus = "success";
  device.status = "online";
  device.lastSeenAt = new Date();
  if (result.latestEventAt) device.sync.lastEventAt = result.latestEventAt;
  await device.save();

  return { received: events.length, ...result };
}

module.exports = {
  listDevices,
  createDevice,
  updateDevice,
  deleteDevice,
  testConnection,
  syncDevice,
  syncDueDevices,
  ingestEvents,
  reprocessUnmapped,
  unmappedSummary,
  listEvents,
  listSyncLogs,
  importFile,
  ingestWebhook,
  shapeDevice,
  BiometricDevice,
  BiometricEvent,
  BiometricSyncLog,
};
