"use strict";

const Shift = require("./shift.model");
const WeeklyOffPolicy = require("./weeklyOffPolicy.model");
const ShiftAssignment = require("./shiftAssignment.model");
const Employee = require("../employees/employee.model");
const { AppError } = require("../../core/errors/AppError");
const audit = require("../../core/audit/audit.service");
const tenant = require("../../core/tenancy/tenantContext");
const { weekdayIndex, weekdayOccurrence, eachDate } = require("../../shared/datetime");

/**
 * Shift resolution and weekly-off evaluation.
 *
 * The attendance engine calls into here for every employee-day it processes,
 * so both lookups are designed to be batched and cached for a run rather than
 * queried per row.
 */

/**
 * The shift that applies to an employee on a given date.
 * Precedence: dated assignment → employee's standing shift → org default.
 */
async function resolveShiftForDate(employee, dateString, cache = null) {
  const employeeId = String(employee._id || employee);

  if (cache && cache.assignments) {
    const assignment = (cache.assignments[employeeId] || []).find(
      (a) => a.fromDate <= dateString && a.toDate >= dateString
    );
    if (assignment) return cache.shifts[String(assignment.shiftId)] || null;
  } else {
    const assignment = await ShiftAssignment.findOne({
      employeeId,
      fromDate: { $lte: dateString },
      toDate: { $gte: dateString },
    })
      .sort({ createdAt: -1 })
      .lean();
    if (assignment) return Shift.findById(assignment.shiftId).lean();
  }

  const standing = employee.employment && employee.employment.shiftId;
  if (standing) {
    if (cache && cache.shifts) return cache.shifts[String(standing)] || null;
    return Shift.findById(standing).lean();
  }

  if (cache && cache.defaultShift !== undefined) return cache.defaultShift;
  return Shift.findOne({ isDefault: true, isActive: true }).lean();
}

/**
 * Is this date a weekly off for this policy?
 * @returns {{ isOff: boolean, isHalfDay: boolean, session: string|null }}
 */
function evaluateWeeklyOff(policy, dateString) {
  if (!policy) return { isOff: false, isHalfDay: false, session: null };

  const day = weekdayIndex(dateString);
  const rule = (policy.days || []).find((d) => d.day === day);
  if (!rule) return { isOff: false, isHalfDay: false, session: null };

  switch (rule.type) {
    case "off":
      return { isOff: true, isHalfDay: false, session: null };
    case "half_day":
      return { isOff: false, isHalfDay: true, session: rule.halfDaySession };
    case "alternate": {
      // "2nd and 4th Saturday off" — the occurrence of that weekday in the month.
      const occurrence = weekdayOccurrence(dateString);
      const isOff = (rule.offOccurrences || []).includes(occurrence);
      return { isOff, isHalfDay: false, session: null };
    }
    case "working":
    default:
      return { isOff: false, isHalfDay: false, session: null };
  }
}

async function resolveWeeklyOffPolicy(employee, cache = null) {
  const id = employee.employment && employee.employment.weeklyOffPolicyId;
  if (id) {
    if (cache && cache.weeklyOffPolicies) return cache.weeklyOffPolicies[String(id)] || null;
    return WeeklyOffPolicy.findById(id).lean();
  }
  if (cache && cache.defaultWeeklyOff !== undefined) return cache.defaultWeeklyOff;
  return WeeklyOffPolicy.findOne({ isDefault: true, isActive: true }).lean();
}

/**
 * Preload everything the attendance engine needs for a batch, so processing a
 * month for 500 employees is a handful of queries rather than tens of thousands.
 */
async function buildResolutionCache({ employeeIds, fromDate, toDate }) {
  const [shifts, policies, assignments, defaultShift, defaultWeeklyOff] = await Promise.all([
    Shift.find({}).lean(),
    WeeklyOffPolicy.find({}).lean(),
    ShiftAssignment.find({
      employeeId: { $in: employeeIds },
      fromDate: { $lte: toDate },
      toDate: { $gte: fromDate },
    }).lean(),
    Shift.findOne({ isDefault: true, isActive: true }).lean(),
    WeeklyOffPolicy.findOne({ isDefault: true, isActive: true }).lean(),
  ]);

  const byEmployee = {};
  for (const a of assignments) {
    const key = String(a.employeeId);
    (byEmployee[key] = byEmployee[key] || []).push(a);
  }

  return {
    shifts: Object.fromEntries(shifts.map((s) => [String(s._id), s])),
    weeklyOffPolicies: Object.fromEntries(policies.map((p) => [String(p._id), p])),
    assignments: byEmployee,
    defaultShift: defaultShift || null,
    defaultWeeklyOff: defaultWeeklyOff || null,
  };
}

/** Assign a shift to employees for a date range. */
async function assign({ employeeIds, shiftId, fromDate, toDate, reason }, req) {
  const shift = await Shift.findById(shiftId).lean();
  if (!shift) throw AppError.badRequest("The selected shift does not exist.");
  if (fromDate > toDate) throw AppError.badRequest("The start date must be on or before the end date.");

  const employees = await Employee.find({ _id: { $in: employeeIds } })
    .select("employeeCode")
    .lean();
  if (employees.length !== employeeIds.length) {
    throw AppError.badRequest("One or more of the selected employees do not exist.");
  }

  // Replacing an overlapping assignment is what the user means by "assign";
  // leaving both would make resolution order-dependent.
  await ShiftAssignment.deleteMany({
    employeeId: { $in: employeeIds },
    fromDate: { $lte: toDate },
    toDate: { $gte: fromDate },
  });

  const created = await ShiftAssignment.insertMany(
    employeeIds.map((employeeId) => ({
      organizationId: tenant.requireOrganizationId(),
      employeeId,
      shiftId,
      fromDate,
      toDate,
      reason: reason || "",
      source: "manual",
      createdBy: tenant.getUserId(),
    }))
  );

  await audit.record(
    {
      action: "shift.assigned",
      entityType: "ShiftAssignment",
      entityLabel: `${shift.name} — ${employeeIds.length} employees`,
      after: { shift: shift.name, fromDate, toDate, employeeCount: employeeIds.length },
      severity: "notice",
    },
    req
  );

  return { assigned: created.length, shift: shift.name, fromDate, toDate };
}

/**
 * A roster grid: one row per employee, one column per date.
 * Used by the shift planner screen.
 */
async function roster({ fromDate, toDate, employeeIds, departmentId }) {
  const filter = { status: { $in: ["active", "on_leave", "notice_period"] } };
  if (employeeIds && employeeIds.length) filter._id = { $in: employeeIds };
  if (departmentId) filter["employment.departmentId"] = departmentId;

  const employees = await Employee.find(filter)
    .select("employeeCode personal.firstName personal.lastName employment.shiftId employment.weeklyOffPolicyId employment.departmentId")
    .sort({ employeeCode: 1 })
    .limit(300)
    .lean();

  const cache = await buildResolutionCache({
    employeeIds: employees.map((e) => e._id),
    fromDate,
    toDate,
  });

  const dates = eachDate(fromDate, toDate, 62);

  const rows = [];
  for (const employee of employees) {
    const weeklyOff = await resolveWeeklyOffPolicy(employee, cache);
    const days = [];
    for (const date of dates) {
      const shift = await resolveShiftForDate(employee, date, cache);
      const off = evaluateWeeklyOff(weeklyOff, date);
      days.push({
        date,
        shiftId: shift ? String(shift._id) : null,
        shiftCode: shift ? shift.code : null,
        shiftName: shift ? shift.name : null,
        colour: shift ? shift.colour : null,
        startTime: shift ? shift.startTime : null,
        endTime: shift ? shift.endTime : null,
        isWeeklyOff: off.isOff,
        isHalfDay: off.isHalfDay,
      });
    }
    rows.push({
      employeeId: String(employee._id),
      employeeCode: employee.employeeCode,
      name: [employee.personal.firstName, employee.personal.lastName].filter(Boolean).join(" "),
      days,
    });
  }

  return { fromDate, toDate, dates, rows };
}

module.exports = {
  resolveShiftForDate,
  resolveWeeklyOffPolicy,
  evaluateWeeklyOff,
  buildResolutionCache,
  assign,
  roster,
  Shift,
  WeeklyOffPolicy,
  ShiftAssignment,
};
