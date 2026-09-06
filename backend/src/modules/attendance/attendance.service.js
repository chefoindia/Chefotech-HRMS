"use strict";

const mongoose = require("mongoose");
const { Punch, AttendanceRecord, AttendanceCorrection, AttendanceLock } = require("./attendance.model");
const AttendancePolicy = require("./attendancePolicy.model");
const engine = require("./attendanceEngine");
const Employee = require("../employees/employee.model");
const Organization = require("../organizations/organization.model");
const Location = require("../locations/location.model");
const shiftService = require("../shifts/shift.service");
const holidayService = require("../holidays/holiday.service");
const settings = require("../../core/settings/settings.service");
const notifications = require("../notifications/notification.service");
const employeeService = require("../employees/employee.service");
const { AppError } = require("../../core/errors/AppError");
const audit = require("../../core/audit/audit.service");
const tenant = require("../../core/tenancy/tenantContext");
const { parseListQuery } = require("../../core/http/queryOptions");
const { logger } = require("../../config/logger");
const dt = require("../../shared/datetime");

/**
 * Attendance orchestration.
 *
 * Punch capture, day processing, corrections and period locking. The actual
 * rules live in attendanceEngine.js — this file's job is to gather the inputs
 * (shift, policy, holiday, weekly off, leave), call the engine, and persist
 * the result.
 *
 * Processing is idempotent. Running it again for a date produces the same
 * record; it is safe to re-run after a late biometric sync, a corrected
 * policy, or an approved leave that changes what a past day meant.
 */

// ── Context resolution ──────────────────────────────────────────────────────

async function organizationTimezone() {
  const org = await tenant.runAsSystem(
    () => Organization.findById(tenant.requireOrganizationId()).select("timezone").lean(),
    "attendance.timezone"
  );
  return (org && org.timezone) || dt.DEFAULT_TZ;
}

/** A location's timezone wins over the organization's, when set. */
async function timezoneFor(employee, orgTimezone, cache = null) {
  const locationId = employee.employment && employee.employment.locationId;
  if (!locationId) return orgTimezone;
  if (cache && cache.locationTimezones) {
    return cache.locationTimezones[String(locationId)] || orgTimezone;
  }
  const location = await Location.findById(locationId).select("timezone").lean();
  return (location && location.timezone) || orgTimezone;
}

async function resolvePolicy(employee, cache = null) {
  const id = employee.employment && employee.employment.attendancePolicyId;
  if (id) {
    if (cache && cache.policies) return cache.policies[String(id)] || cache.defaultPolicy;
    const policy = await AttendancePolicy.findById(id).lean();
    if (policy) return policy;
  }
  if (cache && cache.defaultPolicy !== undefined) return cache.defaultPolicy;
  return AttendancePolicy.findOne({ isDefault: true, isActive: true }).lean();
}

/** Everything the engine needs for a batch, loaded up front. */
async function buildContext({ employees, fromDate, toDate }) {
  const employeeIds = employees.map((e) => e._id);
  const orgTimezone = await organizationTimezone();

  const [shiftCache, holidayCache, policies, defaultPolicy, locations, leaves, optionalSelections] =
    await Promise.all([
      shiftService.buildResolutionCache({ employeeIds, fromDate, toDate }),
      holidayService.buildHolidayCache({ fromDate, toDate }),
      AttendancePolicy.find({}).lean(),
      AttendancePolicy.findOne({ isDefault: true, isActive: true }).lean(),
      Location.find({}).select("timezone geo").lean(),
      loadApprovedLeaves({ employeeIds, fromDate, toDate }),
      holidayService.OptionalHolidaySelection.find({
        employeeId: { $in: employeeIds },
        date: { $gte: fromDate, $lte: toDate },
      }).lean(),
    ]);

  const optionalByEmployee = {};
  for (const s of optionalSelections) {
    const key = String(s.employeeId);
    (optionalByEmployee[key] = optionalByEmployee[key] || []).push(String(s.holidayId));
  }

  return {
    orgTimezone,
    ...shiftCache,
    ...holidayCache,
    optionalSelections: optionalByEmployee,
    policies: Object.fromEntries(policies.map((p) => [String(p._id), p])),
    defaultPolicy: defaultPolicy || null,
    locationTimezones: Object.fromEntries(
      locations.filter((l) => l.timezone).map((l) => [String(l._id), l.timezone])
    ),
    leaves,
  };
}

/**
 * Approved leave, indexed as `${employeeId}:${date}`.
 * Loaded from LeaveDay rows so half-day portions are exact.
 */
async function loadApprovedLeaves({ employeeIds, fromDate, toDate }) {
  const { LeaveDay } = require("../leave/leave.model");
  const rows = await LeaveDay.find({
    employeeId: { $in: employeeIds },
    date: { $gte: fromDate, $lte: toDate },
    status: "approved",
  })
    .populate("leaveTypeId", "name code isPaid")
    .lean()
    .catch(() => []);

  const index = {};
  for (const row of rows) {
    index[`${String(row.employeeId)}:${row.date}`] = {
      type: (row.leaveTypeId && row.leaveTypeId.name) || "Leave",
      code: (row.leaveTypeId && row.leaveTypeId.code) || null,
      dayPortion: row.dayPortion,
      isPaid: row.leaveTypeId ? row.leaveTypeId.isPaid !== false : true,
      leaveRequestId: row.leaveRequestId,
    };
  }
  return index;
}

// ── Punch capture ───────────────────────────────────────────────────────────

/**
 * Record a punch and reprocess that day.
 *
 * Duplicate suppression happens here: two taps within the window are one
 * punch. Devices routinely report the same finger twice, and without this a
 * night-shift worker ends up with a two-minute working day.
 */
const DUPLICATE_WINDOW_SECONDS = 60;

async function recordPunch({
  employeeId,
  at,
  direction = null,
  source,
  deviceId = null,
  rawEventId = null,
  location = null,
  ip = null,
  note = "",
  isManual = false,
}, req) {
  const employee = await Employee.findById(employeeId).lean();
  if (!employee) throw new AppError("EMPLOYEE_NOT_FOUND");

  const orgTimezone = await organizationTimezone();
  const timezone = await timezoneFor(employee, orgTimezone);
  const instant = new Date(at);
  let date = dt.toDateString(instant, timezone);

  // A night shift's 01:00 punch belongs to the previous calendar day.
  const shift = await shiftService.resolveShiftForDate(employee, date, null);
  if (shift && shift.crossesMidnight) {
    const previousDate = dt.addDays(date, -1);
    const previousWindow = dt.resolveShiftWindow(previousDate, shift.startTime, shift.endTime, timezone);
    if (instant >= previousWindow.start && instant <= addHours(previousWindow.end, 4)) {
      date = previousDate;
    }
  }

  const duplicate = await Punch.findOne({
    employeeId,
    at: {
      $gte: new Date(instant.getTime() - DUPLICATE_WINDOW_SECONDS * 1000),
      $lte: new Date(instant.getTime() + DUPLICATE_WINDOW_SECONDS * 1000),
    },
  }).lean();

  if (duplicate) {
    logger.debug({ employeeId, at: instant }, "Duplicate punch suppressed");
    return { punch: duplicate, duplicate: true };
  }

  if (location && source !== "biometric") {
    location.isWithinGeofence = await checkGeofence(employee, location);
  }

  let punch;
  try {
    punch = await Punch.create({
      employeeId,
      date,
      at: instant,
      direction,
      source,
      deviceId,
      rawEventId,
      location,
      ip,
      note,
      isManual,
      addedBy: isManual ? tenant.getUserId() : null,
    });
  } catch (err) {
    // The unique index is the real duplicate guard; the window check above is
    // just a cheaper first pass.
    if (err.code === 11000) {
      return { punch: await Punch.findOne({ employeeId, at: instant, source }).lean(), duplicate: true };
    }
    throw err;
  }

  const record = await processDay(employeeId, date, { req });
  return { punch, record, duplicate: false };
}

async function checkGeofence(employee, location) {
  const enabled = await settings.get("attendance.geofence_enabled");
  if (!enabled) return null;

  const locationId = employee.employment && employee.employment.locationId;
  if (!locationId) return null;

  const work = await Location.findById(locationId).select("geo").lean();
  if (!work || !work.geo || work.geo.latitude === null) return null;

  const radius = work.geo.radiusMetres || (await settings.get("attendance.geofence_radius_metres"));
  const distance = haversineMetres(
    location.latitude,
    location.longitude,
    work.geo.latitude,
    work.geo.longitude
  );
  return distance <= radius;
}

function haversineMetres(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function addHours(date, hours) {
  return new Date(new Date(date).getTime() + hours * 3600000);
}

/** Employee-initiated check in/out from the web or mobile app. */
async function selfPunch(employeeId, { direction, location, note }, req) {
  const captureModes = await settings.get("attendance.capture_mode");
  const source = req && req.headers && /mobile|android|iphone/i.test(req.headers["user-agent"] || "")
    ? "mobile"
    : "web";

  if (!captureModes.includes(source)) {
    throw AppError.forbidden(
      `${source === "web" ? "Web" : "Mobile"} check-in is turned off for your organization.`
    );
  }

  const result = await recordPunch(
    {
      employeeId,
      at: new Date(),
      direction,
      source,
      location,
      ip: req && req.ip,
      note,
    },
    req
  );

  if (location && result.punch.location && result.punch.location.isWithinGeofence === false) {
    logger.warn({ employeeId }, "Punch recorded outside the geofence");
  }

  return result;
}

/**
 * Today, for one employee — the question the mobile app asks on every launch.
 *
 * `todaySnapshot()` above answers the org-wide version and needs
 * `attendance.view`, which an ordinary employee does not have and should not.
 * This is the self-service counterpart: enough to decide whether to offer
 * "Check in" or "Check out", and to show the day so far.
 *
 * Returns a shape even when nothing has happened yet, so the caller never has
 * to distinguish "no record" from "an error".
 */
async function myToday(employeeId) {
  const timezone = await organizationTimezone();
  const date = dt.todayString(timezone);

  const [record, punches] = await Promise.all([
    AttendanceRecord.findOne({ employeeId, date }).lean(),
    Punch.find({ employeeId, date }).sort({ at: 1 }).lean(),
  ]);

  const mapped = punches.map((punch) => ({
    id: String(punch._id),
    at: punch.at,
    direction: punch.direction,
    source: punch.source,
    isWithinGeofence: punch.location ? punch.location.isWithinGeofence : null,
  }));

  // Direction is derived from what is actually recorded rather than trusted
  // from the client: a device with a stale cache must not be able to punch
  // "in" twice and silently break the day.
  const last = mapped.length ? mapped[mapped.length - 1] : null;
  const isCheckedIn = Boolean(last && last.direction === "in");

  return {
    date,
    timezone,
    isCheckedIn,
    nextDirection: isCheckedIn ? "out" : "in",
    firstIn: record ? record.firstIn : mapped.find((p) => p.direction === "in")?.at ?? null,
    lastOut: record ? record.lastOut : null,
    status: record ? record.status : null,
    workedMinutes: record ? record.workedMinutes : 0,
    shift: record && record.shift ? record.shift : null,
    punches: mapped,
  };
}

// ── Processing ──────────────────────────────────────────────────────────────

/** Recompute one employee-day and persist it. */
async function processDay(employeeId, date, { req, context = null, force = false } = {}) {
  const employee = await Employee.findById(employeeId).lean();
  if (!employee) throw new AppError("EMPLOYEE_NOT_FOUND");

  const existing = await AttendanceRecord.findOne({ employeeId, date }).lean();
  if (existing && existing.isLocked && !force) {
    return existing;
  }
  if (existing && existing.isManualOverride && !force) {
    // A human decided this day. Recomputation must not quietly undo that.
    return existing;
  }

  const ctx = context || (await buildContext({ employees: [employee], fromDate: date, toDate: date }));

  const policy = await resolvePolicy(employee, ctx);
  if (!policy) {
    throw AppError.badRequest(
      "No attendance policy is configured. Create one in Settings before processing attendance."
    );
  }

  if (employee.employment && employee.employment.isAttendanceExempt) {
    return upsertRecord(employeeId, date, {
      date,
      status: engine.STATUS.NOT_APPLICABLE,
      payableDays: 1,
      breakdown: [{ rule: "exempt", detail: "This employee is exempt from attendance", effect: "skipped" }],
      policyId: policy._id,
    });
  }

  // Nothing before the joining date, nothing after the last working day.
  const joining = employee.employment && employee.employment.joiningDate;
  if (joining && date < dt.toDateString(joining, ctx.orgTimezone)) return null;
  const lastDay = employee.exit && employee.exit.lastWorkingDay;
  if (lastDay && date > dt.toDateString(lastDay, ctx.orgTimezone)) return null;

  const timezone = await timezoneFor(employee, ctx.orgTimezone, ctx);
  const shift = await shiftService.resolveShiftForDate(employee, date, ctx);
  const weeklyOffPolicy = await shiftService.resolveWeeklyOffPolicy(employee, ctx);
  const weeklyOff = shiftService.evaluateWeeklyOff(weeklyOffPolicy, date);
  const holiday = await holidayService.holidayFor(employee, date, ctx);
  const leave = ctx.leaves[`${String(employeeId)}:${date}`] || null;

  const punches = await Punch.find({ employeeId, date }).sort({ at: 1 }).lean();

  const lateMarkCount = policy.lateMarks.enabled
    ? await countLateMarks(employeeId, date, policy.lateMarks.resetPeriod)
    : 0;

  const computed = engine.calculate({
    date,
    timezone,
    punches,
    shift,
    policy,
    holiday,
    weeklyOff,
    leave,
    override: null,
    lateMarkCount,
  });

  const record = await upsertRecord(employeeId, date, {
    ...computed,
    leaveRequestId: leave ? leave.leaveRequestId : null,
    policyId: policy._id,
    computedAt: new Date(),
  });

  // Tell the employee about things they need to act on.
  if (computed.isMissingPunch && policy.missingPunch.notifyEmployee && employee.userId) {
    await notifyEmployee(employee, "attendance_missing_punch", { date }).catch(() => {});
  }
  if (computed.isLate && (await settings.get("notification.notify_on_late")) && employee.userId) {
    await notifyEmployee(employee, "attendance_late", {
      date,
      checkIn: computed.firstPunchAt,
      lateBy: dt.formatMinutes(computed.lateByMinutes),
      shiftStart: shift ? shift.startTime : "",
    }).catch(() => {});
  }

  return record;
}

async function notifyEmployee(employee, template, attendance) {
  const organization = await tenant.runAsSystem(
    () => Organization.findById(tenant.requireOrganizationId()).lean(),
    "attendance.notify"
  );
  return notifications.notify({
    template,
    recipients: [
      {
        userId: employee.userId,
        employeeId: employee._id,
        email: employee.personal.workEmail,
        firstName: employee.personal.firstName,
      },
    ],
    organization,
    data: { attendance, employee: { name: employee.personal.firstName } },
    entity: { type: "AttendanceRecord", id: null },
  });
}

async function upsertRecord(employeeId, date, fields) {
  delete fields.sessions; // not persisted; derivable from punches
  return AttendanceRecord.findOneAndUpdate(
    { employeeId, date },
    { $set: { ...fields, employeeId, date } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function countLateMarks(employeeId, date, resetPeriod) {
  const start = periodStart(date, resetPeriod);
  return AttendanceRecord.countDocuments({
    employeeId,
    date: { $gte: start, $lt: date },
    isLate: true,
  });
}

function periodStart(date, resetPeriod) {
  const [year, month] = date.split("-").map(Number);
  if (resetPeriod === "yearly") return `${year}-01-01`;
  if (resetPeriod === "quarterly") {
    const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
    return `${year}-${String(quarterStartMonth).padStart(2, "0")}-01`;
  }
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/**
 * Reprocess a date range for a set of employees.
 * Used by the nightly job, by "recalculate" in the UI, and after a policy edit.
 */
async function processRange({ employeeIds = null, fromDate, toDate, force = false }, req) {
  const filter = { status: { $in: ["active", "on_leave", "notice_period", "suspended"] } };
  if (employeeIds && employeeIds.length) filter._id = { $in: employeeIds };

  const employees = await Employee.find(filter).lean();
  if (!employees.length) return { processed: 0, employees: 0, days: 0 };

  const context = await buildContext({ employees, fromDate, toDate });
  const dates = dt.eachDate(fromDate, toDate, 400);

  const locked = await lockedDatesIn(fromDate, toDate);

  let processed = 0;
  let skipped = 0;

  for (const employee of employees) {
    for (const date of dates) {
      if (locked.has(date) && !force) {
        skipped += 1;
        continue;
      }
      try {
        const record = await processDay(employee._id, date, { req, context, force });
        if (record) processed += 1;
      } catch (err) {
        logger.error(
          { err, employeeId: String(employee._id), date },
          "Attendance processing failed for one employee-day"
        );
      }
    }
  }

  logger.info(
    { employees: employees.length, days: dates.length, processed, skipped },
    "Attendance range processed"
  );

  return { processed, skipped, employees: employees.length, days: dates.length };
}

async function lockedDatesIn(fromDate, toDate) {
  const locks = await AttendanceLock.find({
    unlockedAt: null,
    fromDate: { $lte: toDate },
    toDate: { $gte: fromDate },
  }).lean();

  const dates = new Set();
  for (const lock of locks) {
    for (const date of dt.eachDate(lock.fromDate, lock.toDate, 400)) dates.add(date);
  }
  return dates;
}

// ── Reads ───────────────────────────────────────────────────────────────────

async function list(query, auth) {
  const { page, limit, skip } = parseListQuery(query, {
    allowedSort: ["date", "employeeId"],
    defaultSort: "-date",
    maxLimit: 500,
  });

  const scope = employeeService.scopeFilter(auth);
  const employeeFilter = { ...scope.filter };
  if (query.employeeId) employeeFilter._id = query.employeeId;
  if (query.departmentId) employeeFilter["employment.departmentId"] = query.departmentId;
  if (query.locationId) employeeFilter["employment.locationId"] = query.locationId;

  const employees = await Employee.find(employeeFilter).select("_id").lean();
  const employeeIds = employees.map((e) => e._id);

  const filter = { employeeId: { $in: employeeIds } };
  if (query.fromDate || query.toDate) {
    filter.date = {};
    if (query.fromDate) filter.date.$gte = query.fromDate;
    if (query.toDate) filter.date.$lte = query.toDate;
  } else {
    filter.date = { $gte: dt.todayString(await organizationTimezone()) };
  }
  if (query.status) filter.status = query.status;
  if (query.isLate === "true") filter.isLate = true;
  if (query.isMissingPunch === "true") filter.isMissingPunch = true;

  const [items, total] = await Promise.all([
    AttendanceRecord.find(filter)
      .populate({
        path: "employeeId",
        select: "employeeCode personal.firstName personal.lastName employment.departmentId",
        populate: { path: "employment.departmentId", select: "name" },
      })
      .sort({ date: -1, "employeeId.employeeCode": 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    AttendanceRecord.countDocuments(filter),
  ]);

  return { items, page, limit, total };
}

/** A month of attendance for one employee, shaped for a calendar view. */
async function monthlyCalendar(employeeId, { year, month }, auth) {
  await employeeService.assertCanView(auth, employeeId);

  const bounds = dt.monthBounds(year, month);
  const [records, punches, employee] = await Promise.all([
    AttendanceRecord.find({
      employeeId,
      date: { $gte: bounds.start, $lte: bounds.end },
    })
      .sort({ date: 1 })
      .lean(),
    Punch.find({ employeeId, date: { $gte: bounds.start, $lte: bounds.end } })
      .sort({ at: 1 })
      .lean(),
    Employee.findById(employeeId).select("employeeCode personal").lean(),
  ]);

  const punchesByDate = {};
  for (const p of punches) (punchesByDate[p.date] = punchesByDate[p.date] || []).push(p);

  const byDate = Object.fromEntries(records.map((r) => [r.date, r]));
  const days = dt.eachDate(bounds.start, bounds.end).map((date) => ({
    date,
    ...(byDate[date] || { date, status: "pending", payableDays: 0 }),
    punches: (punchesByDate[date] || []).map((p) => ({
      at: p.at,
      direction: p.direction,
      source: p.source,
      isManual: p.isManual,
    })),
  }));

  return {
    employee: {
      id: String(employeeId),
      code: employee && employee.employeeCode,
      name: employee && [employee.personal.firstName, employee.personal.lastName].filter(Boolean).join(" "),
    },
    year,
    month,
    days,
    summary: summarise(records),
  };
}

function summarise(records) {
  const summary = {
    present: 0,
    absent: 0,
    halfDay: 0,
    leave: 0,
    weeklyOff: 0,
    holiday: 0,
    late: 0,
    earlyLeaving: 0,
    missingPunch: 0,
    payableDays: 0,
    workedMinutes: 0,
    overtimeMinutes: 0,
    compOffEarned: 0,
  };

  for (const r of records) {
    if (r.status === "present") summary.present += 1;
    else if (r.status === "absent") summary.absent += 1;
    else if (r.status === "half_day") summary.halfDay += 1;
    else if (r.status === "leave") summary.leave += 1;
    else if (r.status === "weekly_off") summary.weeklyOff += 1;
    else if (r.status === "holiday") summary.holiday += 1;

    if (r.isLate) summary.late += 1;
    if (r.isEarlyLeaving) summary.earlyLeaving += 1;
    if (r.isMissingPunch) summary.missingPunch += 1;

    summary.payableDays += r.payableDays || 0;
    summary.workedMinutes += r.effectiveMinutes || 0;
    if (r.overtimeStatus === "approved") summary.overtimeMinutes += r.overtimeMinutes || 0;
    summary.compOffEarned += r.compOffEarnedDays || 0;
  }

  summary.workedHours = Math.round((summary.workedMinutes / 60) * 100) / 100;
  summary.overtimeHours = Math.round((summary.overtimeMinutes / 60) * 100) / 100;
  return summary;
}

/** Attendance totals for one employee over a period. Consumed by payroll. */
async function summaryFor(employeeId, fromDate, toDate) {
  const records = await AttendanceRecord.find({
    employeeId,
    date: { $gte: fromDate, $lte: toDate },
  }).lean();
  return { ...summarise(records), recordCount: records.length, fromDate, toDate };
}

/** Today at a glance, for the HR dashboard. */
async function todaySnapshot() {
  const timezone = await organizationTimezone();
  const today = dt.todayString(timezone);

  const [counts, totalActive] = await Promise.all([
    AttendanceRecord.aggregate([
      { $match: { date: today } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    Employee.countDocuments({ status: { $in: ["active", "on_leave", "notice_period"] } }),
  ]);

  const byStatus = Object.fromEntries(counts.map((c) => [c._id, c.count]));
  const present = (byStatus.present || 0) + (byStatus.half_day || 0) + (byStatus.work_from_home || 0);
  const lateCount = await AttendanceRecord.countDocuments({ date: today, isLate: true });

  return {
    date: today,
    totalEmployees: totalActive,
    present,
    absent: byStatus.absent || 0,
    onLeave: byStatus.leave || 0,
    weeklyOff: byStatus.weekly_off || 0,
    holiday: byStatus.holiday || 0,
    late: lateCount,
    notMarked: Math.max(0, totalActive - counts.reduce((sum, c) => sum + c.count, 0)),
    attendancePercent: totalActive ? Math.round((present / totalActive) * 100) : 0,
  };
}

// ── Manual override ─────────────────────────────────────────────────────────

async function overrideDay(employeeId, date, { status, checkIn, checkOut, reason, payableDays }, req) {
  await assertNotLocked(date);

  const employee = await Employee.findById(employeeId).lean();
  if (!employee) throw new AppError("EMPLOYEE_NOT_FOUND");

  const before = await AttendanceRecord.findOne({ employeeId, date }).lean();

  const orgTimezone = await organizationTimezone();
  const timezone = await timezoneFor(employee, orgTimezone);

  // Manual times become real punches, so the record still reconciles with a
  // punch list and reprocessing after an unlock produces the same answer.
  if (checkIn) {
    await Punch.findOneAndUpdate(
      { employeeId, date, direction: "in", isManual: true },
      {
        $set: {
          at: dt.combine(date, checkIn, timezone),
          source: "manual",
          isManual: true,
          addedBy: tenant.getUserId(),
          note: reason,
        },
      },
      { upsert: true }
    );
  }
  if (checkOut) {
    await Punch.findOneAndUpdate(
      { employeeId, date, direction: "out", isManual: true },
      {
        $set: {
          at: dt.combine(date, checkOut, timezone),
          source: "manual",
          isManual: true,
          addedBy: tenant.getUserId(),
          note: reason,
        },
      },
      { upsert: true }
    );
  }

  const record = await AttendanceRecord.findOneAndUpdate(
    { employeeId, date },
    {
      $set: {
        employeeId,
        date,
        status,
        payableDays: payableDays !== undefined ? payableDays : payableForStatus(status),
        isManualOverride: true,
        overrideReason: reason,
        overriddenBy: tenant.getUserId(),
        computedAt: new Date(),
      },
      $push: {
        breakdown: {
          rule: "manual_override",
          detail: reason || "Changed by HR",
          effect: `status = ${status}`,
        },
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  await audit.record(
    {
      action: "attendance.overridden",
      entityType: "AttendanceRecord",
      entityId: record._id,
      entityLabel: `${employee.employeeCode} — ${date}`,
      before: before ? { status: before.status, payableDays: before.payableDays } : null,
      after: { status: record.status, payableDays: record.payableDays },
      severity: "warning",
      description: reason,
    },
    req
  );

  return record;
}

function payableForStatus(status) {
  return { present: 1, half_day: 0.5, absent: 0, holiday: 1, weekly_off: 1, leave: 1, on_duty: 1, work_from_home: 1, comp_off: 1 }[status] || 0;
}

async function assertNotLocked(date) {
  const lock = await AttendanceLock.findOne({
    unlockedAt: null,
    fromDate: { $lte: date },
    toDate: { $gte: date },
  }).lean();
  if (lock) {
    throw new AppError("ATTENDANCE_LOCKED", {
      message: `Attendance from ${lock.fromDate} to ${lock.toDate} is locked and cannot be changed.`,
    });
  }
}

// ── Locking ─────────────────────────────────────────────────────────────────

async function lockPeriod({ fromDate, toDate, reason }, req) {
  const overlapping = await AttendanceLock.findOne({
    unlockedAt: null,
    fromDate: { $lte: toDate },
    toDate: { $gte: fromDate },
  }).lean();
  if (overlapping) {
    throw AppError.conflict(
      `Part of that period is already locked (${overlapping.fromDate} to ${overlapping.toDate}).`
    );
  }

  const lock = await AttendanceLock.create({
    fromDate,
    toDate,
    reason: reason || "",
    lockedBy: tenant.getUserId(),
  });

  const result = await AttendanceRecord.updateMany(
    { date: { $gte: fromDate, $lte: toDate } },
    { $set: { isLocked: true, lockedAt: new Date(), lockedBy: tenant.getUserId() } }
  );

  await audit.record(
    {
      action: "attendance.period_locked",
      entityType: "AttendanceLock",
      entityId: lock._id,
      entityLabel: `${fromDate} to ${toDate}`,
      after: { fromDate, toDate, recordsLocked: result.modifiedCount },
      severity: "warning",
      description: reason,
    },
    req
  );

  return { id: String(lock._id), fromDate, toDate, recordsLocked: result.modifiedCount };
}

async function unlockPeriod(lockId, { reason }, req) {
  const lock = await AttendanceLock.findById(lockId);
  if (!lock) throw AppError.notFound("Attendance lock");
  if (lock.unlockedAt) throw AppError.badRequest("That period is already unlocked.");

  lock.unlockedAt = new Date();
  lock.unlockedBy = tenant.getUserId();
  lock.unlockReason = reason || "";
  await lock.save();

  const result = await AttendanceRecord.updateMany(
    { date: { $gte: lock.fromDate, $lte: lock.toDate } },
    { $set: { isLocked: false, lockedAt: null, lockedBy: null } }
  );

  await audit.record(
    {
      action: "attendance.period_unlocked",
      entityType: "AttendanceLock",
      entityId: lock._id,
      entityLabel: `${lock.fromDate} to ${lock.toDate}`,
      after: { recordsUnlocked: result.modifiedCount, reason },
      // Unlocking a period that payroll may already have used is exactly the
      // kind of thing an auditor comes looking for.
      severity: "critical",
      description: reason,
    },
    req
  );

  return { id: String(lock._id), unlocked: true, recordsUnlocked: result.modifiedCount };
}

async function listLocks() {
  return AttendanceLock.find({}).sort({ fromDate: -1 }).limit(50).lean();
}

// ── Corrections ─────────────────────────────────────────────────────────────

async function requestCorrection(employeeId, data, req) {
  const employee = await Employee.findById(employeeId).lean();
  if (!employee) throw new AppError("EMPLOYEE_NOT_FOUND");

  const policy = await resolvePolicy(employee);
  if (!policy || !policy.regularization.enabled) {
    throw AppError.forbidden("Attendance regularization is turned off for your organization.");
  }

  await assertNotLocked(data.date);

  const timezone = await organizationTimezone();
  const today = dt.todayString(timezone);

  if (data.date > today && !(await settings.get("attendance.allow_future_dated_correction"))) {
    throw AppError.badRequest("You cannot raise a correction for a future date.");
  }

  const windowDays = policy.regularization.windowDays;
  if (windowDays > 0 && data.date < dt.addDays(today, -windowDays)) {
    throw AppError.badRequest(
      `Corrections can only be raised within ${windowDays} days. ${data.date} is outside that window.`
    );
  }

  const monthStart = `${today.slice(0, 7)}-01`;
  const usedThisMonth = await AttendanceCorrection.countDocuments({
    employeeId,
    createdAt: { $gte: new Date(`${monthStart}T00:00:00Z`) },
    status: { $in: ["pending", "approved"] },
  });
  if (policy.regularization.maxPerMonth > 0 && usedThisMonth >= policy.regularization.maxPerMonth) {
    throw AppError.conflict(
      `You have used all ${policy.regularization.maxPerMonth} regularization requests for this month.`
    );
  }

  const pending = await AttendanceCorrection.findOne({
    employeeId,
    date: data.date,
    status: "pending",
  }).lean();
  if (pending) {
    throw AppError.conflict("A correction request for that date is already awaiting approval.");
  }

  const previous = await AttendanceRecord.findOne({ employeeId, date: data.date }).lean();

  const correction = await AttendanceCorrection.create({
    employeeId,
    date: data.date,
    type: data.type,
    requested: data.requested,
    previous: previous
      ? { status: previous.status, firstPunchAt: previous.firstPunchAt, lastPunchAt: previous.lastPunchAt }
      : null,
    reason: data.reason,
    attachmentFileId: data.attachmentFileId || null,
    status: policy.regularization.requiresApproval ? "pending" : "approved",
    createdBy: tenant.getUserId(),
  });

  if (!policy.regularization.requiresApproval) {
    await applyCorrection(correction, req);
  } else {
    await notifyApprovers(employee, correction);
  }

  await audit.record(
    {
      action: "attendance.correction_requested",
      entityType: "AttendanceCorrection",
      entityId: correction._id,
      entityLabel: `${employee.employeeCode} — ${data.date}`,
      after: { type: data.type, requested: data.requested, reason: data.reason },
      severity: "notice",
    },
    req
  );

  return correction;
}

async function notifyApprovers(employee, correction) {
  const managerId = employee.employment && employee.employment.managerId;
  if (!managerId) return;
  const manager = await Employee.findById(managerId).select("userId personal").lean();
  if (!manager || !manager.userId) return;

  const organization = await tenant.runAsSystem(
    () => Organization.findById(tenant.requireOrganizationId()).lean(),
    "attendance.notify-approver"
  );

  await notifications.notify({
    template: "attendance_correction_requested",
    recipients: [
      {
        userId: manager.userId,
        employeeId: manager._id,
        email: manager.personal.workEmail,
        firstName: manager.personal.firstName,
      },
    ],
    organization,
    data: {
      employee: {
        name: [employee.personal.firstName, employee.personal.lastName].filter(Boolean).join(" "),
      },
      correction: {
        id: String(correction._id),
        date: correction.date,
        reason: correction.reason,
      },
    },
    entity: { type: "AttendanceCorrection", id: correction._id },
  });
}

async function reviewCorrection(correctionId, { decision, comment }, req) {
  const correction = await AttendanceCorrection.findById(correctionId);
  if (!correction) throw AppError.notFound("Correction request");
  if (correction.status !== "pending") {
    throw new AppError("WORKFLOW_INVALID_STATE", {
      message: `This request has already been ${correction.status}.`,
    });
  }

  correction.status = decision === "approve" ? "approved" : "rejected";
  correction.reviewedBy = tenant.getUserId();
  correction.reviewedAt = new Date();
  correction.reviewComment = comment || "";
  await correction.save();

  if (correction.status === "approved") await applyCorrection(correction, req);

  const employee = await Employee.findById(correction.employeeId).lean();
  if (employee && employee.userId) {
    const organization = await tenant.runAsSystem(
      () => Organization.findById(tenant.requireOrganizationId()).lean(),
      "attendance.notify-correction"
    );
    await notifications
      .notify({
        template: "attendance_correction_resolved",
        recipients: [
          {
            userId: employee.userId,
            employeeId: employee._id,
            email: employee.personal.workEmail,
            firstName: employee.personal.firstName,
          },
        ],
        organization,
        data: { correction: { date: correction.date, status: correction.status } },
        entity: { type: "AttendanceCorrection", id: correction._id },
      })
      .catch(() => {});
  }

  await audit.record(
    {
      action: `attendance.correction_${correction.status}`,
      entityType: "AttendanceCorrection",
      entityId: correction._id,
      entityLabel: `${employee && employee.employeeCode} — ${correction.date}`,
      after: { status: correction.status, comment },
      severity: "notice",
    },
    req
  );

  return correction;
}

/** Turn an approved correction into punches, then recompute the day. */
async function applyCorrection(correction, req) {
  const employee = await Employee.findById(correction.employeeId).lean();
  const orgTimezone = await organizationTimezone();
  const timezone = await timezoneFor(employee, orgTimezone);

  const { checkIn, checkOut, status } = correction.requested || {};

  if (checkIn) {
    await Punch.findOneAndUpdate(
      { employeeId: correction.employeeId, date: correction.date, direction: "in", isManual: true },
      {
        $set: {
          at: dt.combine(correction.date, checkIn, timezone),
          source: "manual",
          isManual: true,
          addedBy: correction.reviewedBy || correction.createdBy,
          note: `Regularization: ${correction.reason}`,
        },
      },
      { upsert: true }
    );
  }
  if (checkOut) {
    await Punch.findOneAndUpdate(
      { employeeId: correction.employeeId, date: correction.date, direction: "out", isManual: true },
      {
        $set: {
          at: dt.combine(correction.date, checkOut, timezone),
          source: "manual",
          isManual: true,
          addedBy: correction.reviewedBy || correction.createdBy,
          note: `Regularization: ${correction.reason}`,
        },
      },
      { upsert: true }
    );
  }

  if (status && !checkIn && !checkOut) {
    await overrideDay(
      correction.employeeId,
      correction.date,
      { status, reason: `Regularization: ${correction.reason}` },
      req
    );
  } else {
    await processDay(correction.employeeId, correction.date, { req, force: true });
  }

  correction.appliedAt = new Date();
  await correction.save();
}

async function listCorrections(query, auth) {
  const { page, limit, skip } = parseListQuery(query, {
    allowedSort: ["createdAt", "date"],
    defaultSort: "-createdAt",
  });

  const scope = employeeService.scopeFilter(auth);
  const employees = await Employee.find(scope.filter).select("_id").lean();

  const filter = { employeeId: { $in: employees.map((e) => e._id) } };
  if (query.status) filter.status = query.status;
  if (query.employeeId) filter.employeeId = query.employeeId;

  const [items, total] = await Promise.all([
    AttendanceCorrection.find(filter)
      .populate({ path: "employeeId", select: "employeeCode personal.firstName personal.lastName" })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    AttendanceCorrection.countDocuments(filter),
  ]);

  return { items, page, limit, total };
}

/** Approve or reject accrued overtime. */
async function reviewOvertime(recordIds, decision, req) {
  const records = await AttendanceRecord.find({
    _id: { $in: recordIds },
    overtimeStatus: "pending",
  });

  for (const record of records) {
    record.overtimeStatus = decision === "approve" ? "approved" : "rejected";
    record.overtimeApprovedBy = tenant.getUserId();
    await record.save();
  }

  // Approved overtime is money on the next payslip; the person should know.
  if (decision === "approve" && records.length) {
    const employees = await Employee.find({ _id: { $in: records.map((r) => r.employeeId) } })
      .select("userId personal.firstName personal.lastName personal.workEmail")
      .lean();
    const byId = Object.fromEntries(employees.map((e) => [String(e._id), e]));
    for (const record of records) {
      const employee = byId[String(record.employeeId)];
      if (!employee || !employee.userId) continue;
      await notifyEmployee(employee, "overtime_approved", {
        date: record.date,
        hours: Math.round(((record.overtimeMinutes || 0) / 60) * 100) / 100,
      }).catch(() => {});
    }
  }

  await audit.record(
    {
      action: `attendance.overtime_${decision}d`,
      entityType: "AttendanceRecord",
      entityLabel: `${records.length} records`,
      after: { count: records.length, decision },
      severity: "notice",
    },
    req
  );

  return { updated: records.length };
}

module.exports = {
  recordPunch,
  selfPunch,
  processDay,
  processRange,
  buildContext,
  resolvePolicy,
  list,
  monthlyCalendar,
  summaryFor,
  summarise,
  todaySnapshot,
  myToday,
  overrideDay,
  lockPeriod,
  unlockPeriod,
  listLocks,
  assertNotLocked,
  requestCorrection,
  reviewCorrection,
  listCorrections,
  reviewOvertime,
  organizationTimezone,
  Punch,
  AttendanceRecord,
  AttendanceCorrection,
  AttendanceLock,
  AttendancePolicy,
};
