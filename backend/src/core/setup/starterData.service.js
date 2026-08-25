"use strict";

const starter = require("./starterData");
const { logger } = require("../../config/logger");

/**
 * Applies the starter configuration to an organization.
 *
 * Idempotent by code: anything already present is left exactly as it is, so
 * running this twice never duplicates a component or silently overwrites an
 * edit someone made. That matters because it runs at provisioning time AND is
 * reachable on demand from setup, where a customer may have already started
 * configuring things by hand.
 *
 * Deliberately non-fatal: if seeding fails, the organization still exists and
 * is usable — an empty settings screen is a bad first impression, a failed
 * signup is a lost customer.
 */
async function seedStarterData({ skipExisting = true } = {}) {
  const Shift = require("../../modules/shifts/shift.model");
  const AttendancePolicy = require("../../modules/attendance/attendancePolicy.model");
  const { LeaveType } = require("../../modules/leave/leave.model");
  const { SalaryComponent } = require("../../modules/payroll/payroll.model");

  const created = { shifts: 0, attendancePolicies: 0, leaveTypes: 0, salaryComponents: 0 };

  /** Insert only the rows whose `code` is not already taken. */
  const insertMissing = async (Model, rows, label) => {
    const existing = await Model.find({}).select("code").lean();
    const have = new Set(existing.map((row) => row.code));
    const missing = skipExisting ? rows.filter((row) => !have.has(row.code)) : rows;
    if (!missing.length) return 0;
    await Model.insertMany(missing);
    logger.debug({ label, count: missing.length }, "Seeded starter data");
    return missing.length;
  };

  created.shifts = await insertMissing(Shift, starter.DEFAULT_SHIFTS, "shifts");
  created.attendancePolicies = await insertMissing(
    AttendancePolicy,
    [starter.DEFAULT_ATTENDANCE_POLICY],
    "attendance policy"
  );
  created.leaveTypes = await insertMissing(LeaveType, starter.DEFAULT_LEAVE_TYPES, "leave types");
  created.salaryComponents = await insertMissing(
    SalaryComponent,
    starter.DEFAULT_SALARY_COMPONENTS,
    "salary components"
  );

  return created;
}

module.exports = { seedStarterData };
