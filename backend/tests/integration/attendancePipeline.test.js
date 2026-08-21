"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const { startDatabase, stopDatabase, clearDatabase } = require("../helpers/db");
const tenant = require("../../src/core/tenancy/tenantContext");
const dt = require("../../src/shared/datetime");

const Organization = require("../../src/modules/organizations/organization.model");
const Employee = require("../../src/modules/employees/employee.model");
const Shift = require("../../src/modules/shifts/shift.model");
const WeeklyOffPolicy = require("../../src/modules/shifts/weeklyOffPolicy.model");
const AttendancePolicy = require("../../src/modules/attendance/attendancePolicy.model");
const { Punch, AttendanceRecord, AttendanceLock } = require("../../src/modules/attendance/attendance.model");
const attendanceService = require("../../src/modules/attendance/attendance.service");
const biometricService = require("../../src/modules/biometric/biometric.service");
const BiometricDevice = require("../../src/modules/biometric/biometricDevice.model");
const { BiometricEvent } = require("../../src/modules/biometric/biometricEvent.model");

/**
 * The punch → attendance pipeline, end to end against a real database.
 *
 * These cover the failure modes that actually bite in production: devices
 * re-sending their whole buffer, night shifts landing on the wrong day, and
 * locked periods being silently recalculated.
 */

const ORG = new mongoose.Types.ObjectId();
const TZ = "Asia/Kolkata";
const DATE = "2026-08-20"; // Thursday

let employee;
let generalShift;
let nightShift;

test.before(async () => {
  await startDatabase();
});

test.after(async () => {
  await stopDatabase();
});

test.beforeEach(async () => {
  await clearDatabase();

  await tenant.runAsSystem(
    () => Organization.create({ _id: ORG, name: "Pipeline Co", slug: "pipeline-co", timezone: TZ }),
    "test.setup"
  );

  await tenant.runWithTenant(ORG, async () => {
    generalShift = await Shift.create({
      name: "General",
      code: "GEN",
      startTime: "09:00",
      endTime: "18:00",
      breakMinutes: 60,
      isDefault: true,
    });

    nightShift = await Shift.create({
      name: "Night",
      code: "NGT",
      startTime: "22:00",
      endTime: "06:00",
      breakMinutes: 45,
    });

    await WeeklyOffPolicy.create({ name: "Sunday off", code: "STD", isDefault: true });

    await AttendancePolicy.create({
      name: "Standard",
      code: "STD",
      isDefault: true,
      overtime: { enabled: true, startsAfterMinutes: 30, minimumMinutes: 30, roundToMinutes: 30 },
    });

    employee = await Employee.create({
      employeeCode: "EMP0001",
      biometricId: "1001",
      personal: { firstName: "Ravi", lastName: "Kumar" },
      employment: { shiftId: generalShift._id, joiningDate: new Date("2024-01-01") },
      status: "active",
    });
  });
});

// ── Punch to record ─────────────────────────────────────────────────────────

test("a pair of punches produces a present record", async () => {
  await tenant.runWithTenant(ORG, async () => {
    await attendanceService.recordPunch({
      employeeId: employee._id,
      at: dt.combine(DATE, "09:00", TZ),
      direction: "in",
      source: "biometric",
    });
    await attendanceService.recordPunch({
      employeeId: employee._id,
      at: dt.combine(DATE, "18:00", TZ),
      direction: "out",
      source: "biometric",
    });

    const record = await AttendanceRecord.findOne({ employeeId: employee._id, date: DATE }).lean();

    assert.equal(record.status, "present");
    assert.equal(record.payableDays, 1);
    assert.equal(record.effectiveMinutes, 480);
    assert.equal(record.punchCount, 2);
    assert.ok(record.breakdown.length > 0, "the record explains itself");
  });
});

test("a repeated tap within the duplicate window is suppressed", async () => {
  await tenant.runWithTenant(ORG, async () => {
    const at = dt.combine(DATE, "09:00", TZ);

    const first = await attendanceService.recordPunch({
      employeeId: employee._id,
      at,
      direction: "in",
      source: "biometric",
    });
    const second = await attendanceService.recordPunch({
      employeeId: employee._id,
      at: new Date(at.getTime() + 20_000),
      direction: "in",
      source: "biometric",
    });

    assert.equal(first.duplicate, false);
    assert.equal(second.duplicate, true);
    assert.equal(await Punch.countDocuments({ employeeId: employee._id }), 1);
  });
});

test("the exact same punch cannot be stored twice", async () => {
  await tenant.runWithTenant(ORG, async () => {
    await Punch.syncIndexes();
    const at = dt.combine(DATE, "09:00", TZ);

    await attendanceService.recordPunch({
      employeeId: employee._id,
      at,
      direction: "in",
      source: "biometric",
    });
    const again = await attendanceService.recordPunch({
      employeeId: employee._id,
      at,
      direction: "in",
      source: "biometric",
    });

    assert.equal(again.duplicate, true);
    assert.equal(await Punch.countDocuments({}), 1);
  });
});

test("reprocessing a day is idempotent", async () => {
  await tenant.runWithTenant(ORG, async () => {
    await attendanceService.recordPunch({
      employeeId: employee._id,
      at: dt.combine(DATE, "09:12", TZ),
      direction: "in",
      source: "biometric",
    });
    await attendanceService.recordPunch({
      employeeId: employee._id,
      at: dt.combine(DATE, "18:45", TZ),
      direction: "out",
      source: "biometric",
    });

    const first = await AttendanceRecord.findOne({ employeeId: employee._id, date: DATE }).lean();

    for (let i = 0; i < 3; i += 1) {
      await attendanceService.processDay(employee._id, DATE, { force: true });
    }

    const after = await AttendanceRecord.findOne({ employeeId: employee._id, date: DATE }).lean();

    assert.equal(await AttendanceRecord.countDocuments({ employeeId: employee._id, date: DATE }), 1);
    assert.equal(after.status, first.status);
    assert.equal(after.effectiveMinutes, first.effectiveMinutes);
    assert.equal(after.overtimeMinutes, first.overtimeMinutes);
  });
});

// ── Night shifts ────────────────────────────────────────────────────────────

test("a night shift exit after midnight belongs to the shift's own date", async () => {
  await tenant.runWithTenant(ORG, async () => {
    await Employee.updateOne(
      { _id: employee._id },
      { $set: { "employment.shiftId": nightShift._id } }
    );
    const nightEmployee = await Employee.findById(employee._id).lean();

    await attendanceService.recordPunch({
      employeeId: nightEmployee._id,
      at: dt.combine(DATE, "22:05", TZ),
      direction: "in",
      source: "biometric",
    });
    // 06:00 the NEXT morning.
    await attendanceService.recordPunch({
      employeeId: nightEmployee._id,
      at: dt.combine("2026-08-21", "06:05", TZ),
      direction: "out",
      source: "biometric",
    });

    const punches = await Punch.find({ employeeId: nightEmployee._id }).lean();
    assert.equal(punches.length, 2);
    assert.deepEqual(
      punches.map((p) => p.date),
      [DATE, DATE],
      "both punches are attributed to the night the shift started"
    );

    const record = await AttendanceRecord.findOne({
      employeeId: nightEmployee._id,
      date: DATE,
    }).lean();

    assert.equal(record.status, "present");
    assert.equal(record.effectiveMinutes, 435, "8 hours less a 45 minute break");

    const nextDay = await AttendanceRecord.findOne({
      employeeId: nightEmployee._id,
      date: "2026-08-21",
    }).lean();
    assert.equal(nextDay, null, "no phantom record on the following day");
  });
});

// ── Locking ─────────────────────────────────────────────────────────────────

test("a locked period is not recalculated", async () => {
  await tenant.runWithTenant(ORG, async () => {
    await attendanceService.recordPunch({
      employeeId: employee._id,
      at: dt.combine(DATE, "09:00", TZ),
      direction: "in",
      source: "biometric",
    });
    await attendanceService.recordPunch({
      employeeId: employee._id,
      at: dt.combine(DATE, "18:00", TZ),
      direction: "out",
      source: "biometric",
    });

    await attendanceService.lockPeriod(
      { fromDate: DATE, toDate: DATE, reason: "Payroll" },
      null
    );

    const before = await AttendanceRecord.findOne({ employeeId: employee._id, date: DATE }).lean();
    assert.equal(before.isLocked, true);

    // A punch arriving after the lock must not move the numbers.
    await Punch.create({
      organizationId: ORG,
      employeeId: employee._id,
      date: DATE,
      at: dt.combine(DATE, "21:00", TZ),
      direction: "out",
      source: "manual",
    });
    await attendanceService.processDay(employee._id, DATE, {});

    const after = await AttendanceRecord.findOne({ employeeId: employee._id, date: DATE }).lean();
    assert.equal(after.effectiveMinutes, before.effectiveMinutes, "the locked figure stands");
  });
});

test("a locked day cannot be overridden by hand", async () => {
  await tenant.runWithTenant(ORG, async () => {
    await attendanceService.lockPeriod({ fromDate: DATE, toDate: DATE, reason: "Payroll" }, null);

    await assert.rejects(
      () =>
        attendanceService.overrideDay(
          employee._id,
          DATE,
          { status: "present", reason: "Trying anyway" },
          null
        ),
      (err) => err.code === "ATTENDANCE_LOCKED"
    );
  });
});

test("unlocking restores the ability to recalculate", async () => {
  await tenant.runWithTenant(ORG, async () => {
    const lock = await attendanceService.lockPeriod(
      { fromDate: DATE, toDate: DATE, reason: "Payroll" },
      null
    );

    await attendanceService.unlockPeriod(lock.id, { reason: "Correction needed" }, null);

    const record = await AttendanceLock.findById(lock.id).lean();
    assert.ok(record.unlockedAt);
    assert.equal(record.unlockReason, "Correction needed");

    await assert.doesNotReject(() =>
      attendanceService.overrideDay(
        employee._id,
        DATE,
        { status: "present", reason: "Corrected" },
        null
      )
    );
  });
});

// ── Manual override ─────────────────────────────────────────────────────────

test("a manual override survives a later recalculation", async () => {
  await tenant.runWithTenant(ORG, async () => {
    await attendanceService.overrideDay(
      employee._id,
      DATE,
      { status: "on_duty", reason: "Client site visit" },
      null
    );

    await attendanceService.processDay(employee._id, DATE, {});

    const record = await AttendanceRecord.findOne({ employeeId: employee._id, date: DATE }).lean();
    assert.equal(record.status, "on_duty");
    assert.equal(record.isManualOverride, true);
    assert.equal(record.overrideReason, "Client site visit");
  });
});

// ── Biometric ingestion ─────────────────────────────────────────────────────

test("re-ingesting the same device events creates no duplicate punches", async () => {
  await tenant.runWithTenant(ORG, async () => {
    await BiometricEvent.syncIndexes();
    await Punch.syncIndexes();

    const device = await BiometricDevice.create({
      name: "Gate",
      code: "GATE1",
      provider: "file",
      mode: "file",
    });

    const events = [
      { deviceUserId: "1001", occurredAt: dt.combine(DATE, "09:02", TZ), direction: "in" },
      { deviceUserId: "1001", occurredAt: dt.combine(DATE, "18:10", TZ), direction: "out" },
    ];

    const first = await biometricService.ingestEvents(device, events, {});
    assert.equal(first.created, 2);
    assert.equal(first.punches, 2);

    // The device is rebooted and re-sends its whole buffer.
    const second = await biometricService.ingestEvents(device, events, {});
    assert.equal(second.created, 0);
    assert.equal(second.duplicates, 2);
    assert.equal(second.punches, 0);

    assert.equal(await Punch.countDocuments({}), 2);
    assert.equal(await BiometricEvent.countDocuments({}), 2);

    const record = await AttendanceRecord.findOne({ employeeId: employee._id, date: DATE }).lean();
    assert.equal(record.status, "present");
  });
});

test("an unknown device id is retained as unmapped, then reprocessed once fixed", async () => {
  await tenant.runWithTenant(ORG, async () => {
    await BiometricEvent.syncIndexes();

    const device = await BiometricDevice.create({
      name: "Gate",
      code: "GATE1",
      provider: "file",
      mode: "file",
    });

    // Nobody is enrolled as 9999 yet.
    const result = await biometricService.ingestEvents(
      device,
      [
        { deviceUserId: "9999", occurredAt: dt.combine(DATE, "09:00", TZ), direction: "in" },
        { deviceUserId: "9999", occurredAt: dt.combine(DATE, "18:00", TZ), direction: "out" },
      ],
      {}
    );

    assert.equal(result.unmapped, 2);
    assert.equal(result.punches, 0);
    assert.deepEqual(result.unmappedIds, ["9999"]);

    const summary = await biometricService.unmappedSummary();
    assert.equal(summary[0].deviceUserId, "9999");
    assert.equal(summary[0].count, 2);

    // An administrator corrects the enrolment id.
    await Employee.updateOne({ _id: employee._id }, { $set: { biometricId: "9999" } });

    const reprocessed = await biometricService.reprocessUnmapped({}, null);
    assert.equal(reprocessed.reprocessed, 2);
    assert.equal(reprocessed.stillUnmapped, 0);

    const record = await AttendanceRecord.findOne({ employeeId: employee._id, date: DATE }).lean();
    assert.equal(record.status, "present", "the attendance appears retroactively");
  });
});

test("raw biometric events are never rewritten by ingestion", async () => {
  await tenant.runWithTenant(ORG, async () => {
    await BiometricEvent.syncIndexes();

    const device = await BiometricDevice.create({
      name: "Gate",
      code: "GATE1",
      provider: "file",
      mode: "file",
    });

    const occurredAt = dt.combine(DATE, "09:00", TZ);
    await biometricService.ingestEvents(device, [{ deviceUserId: "1001", occurredAt, direction: "in" }], {});

    const raw = await BiometricEvent.findOne({}).lean();
    assert.equal(raw.deviceUserId, "1001");
    assert.equal(new Date(raw.occurredAt).getTime(), occurredAt.getTime());
    assert.equal(raw.processingStatus, "mapped");
    assert.ok(raw.punchId, "the raw event points at the punch it produced");
  });
});

// ── Summaries ───────────────────────────────────────────────────────────────

test("the period summary matches the records behind it", async () => {
  await tenant.runWithTenant(ORG, async () => {
    const days = ["2026-08-17", "2026-08-18", "2026-08-19"];
    for (const date of days) {
      await attendanceService.recordPunch({
        employeeId: employee._id,
        at: dt.combine(date, "09:00", TZ),
        direction: "in",
        source: "biometric",
      });
      await attendanceService.recordPunch({
        employeeId: employee._id,
        at: dt.combine(date, "18:00", TZ),
        direction: "out",
        source: "biometric",
      });
    }

    const summary = await attendanceService.summaryFor(employee._id, "2026-08-17", "2026-08-19");

    assert.equal(summary.present, 3);
    assert.equal(summary.payableDays, 3);
    assert.equal(summary.workedHours, 24);
  });
});
