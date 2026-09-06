"use strict";

const Employee = require("../employees/employee.model");
const { LeaveDay, LeaveType } = require("../leave/leave.model");
const { AttendanceRecord } = require("../attendance/attendance.model");
const notifications = require("./notification.service");
const recipients = require("./recipients");
const settings = require("../../core/settings/settings.service");
const dt = require("../../shared/datetime");
const { logger } = require("../../config/logger");

/**
 * The things that happen because a date arrived, not because someone did
 * something.
 *
 * Joiners, birthdays, anniversaries, probation reviews falling due, leave
 * starting tomorrow, a holiday tomorrow, an absence nobody explained — none
 * of these had a trigger. The templates existed (`employee_joined`,
 * `birthday_today`) and nothing ever raised them, so the default rule "tell
 * the department head when someone joins their team" was seeded into every
 * organization and never fired once.
 *
 * Runs once per organization per day from the scheduler. Every section is
 * independent and non-fatal: a broken birthday query must not stop the
 * probation reminders.
 */

const ACTIVE = ["active", "on_leave", "notice_period"];

async function run({ date, timezone }) {
  const today = date || dt.todayString(timezone);
  const organization = await recipients.organization();
  const summary = {};

  const sections = [
    ["joiners", () => joinersToday(today, timezone, organization)],
    ["birthdays", () => birthdaysToday(today, timezone, organization)],
    ["anniversaries", () => anniversariesToday(today, timezone, organization)],
    ["probation", () => probationEnding(today, organization)],
    ["leaveTomorrow", () => leaveStartingTomorrow(today, organization)],
    ["holidayTomorrow", () => holidayTomorrow(today, organization)],
    ["absentYesterday", () => absentYesterday(today, organization)],
    ["leaveBalanceLow", () => leaveBalanceLow(today, organization)],
  ];

  for (const [name, fn] of sections) {
    try {
      summary[name] = await fn();
    } catch (err) {
      logger.error({ err, section: name }, "Daily events section failed");
      summary[name] = { error: err.message };
    }
  }
  return summary;
}

function fullName(e) {
  return [e.personal.firstName, e.personal.lastName].filter(Boolean).join(" ");
}

async function joinersToday(today, timezone, organization) {
  const joiners = await Employee.find({
    "employment.joiningDate": { $gte: dt.startOfDay(today, timezone), $lte: dt.endOfDay(today, timezone) },
    status: { $in: ["active", "invited", "draft"] },
  })
    .populate([
      { path: "employment.departmentId", select: "name" },
      { path: "employment.designationId", select: "name" },
    ])
    .lean();
  if (!joiners.length) return { count: 0 };

  const hr = await recipients.usersWithPermission("employee.create");
  let notified = 0;
  for (const employee of joiners) {
    const outcome = await notifications.notify({
      template: "employee_joined",
      recipients: hr,
      organization,
      data: {
        employee: {
          id: String(employee._id),
          name: fullName(employee),
          department: (employee.employment.departmentId && employee.employment.departmentId.name) || "—",
          designation: (employee.employment.designationId && employee.employment.designationId.name) || "—",
        },
      },
      entity: { type: "Employee", id: employee._id },
    });
    notified += outcome.sent;
  }
  return { count: joiners.length, notified };
}

async function birthdaysToday(today, timezone, organization) {
  const monthDay = today.slice(5);
  const people = await Employee.aggregate([
    { $match: { status: { $in: ACTIVE }, "personal.dateOfBirth": { $ne: null } } },
    { $addFields: { md: { $dateToString: { date: "$personal.dateOfBirth", format: "%m-%d", timezone } } } },
    { $match: { md: monthDay } },
    { $project: { userId: 1, personal: 1 } },
  ]);
  if (!people.length) return { count: 0 };

  const greet = await settings.get("notification.birthday_wishes").catch(() => true);
  let greeted = 0;
  if (greet) {
    for (const employee of people) {
      const outcome = await notifications.notify({
        template: "birthday_greeting",
        recipients: [recipients.employeeToRecipient(employee)],
        organization,
        data: { employee: { firstName: employee.personal.firstName, name: fullName(employee) } },
        severity: "success",
        entity: { type: "Employee", id: employee._id },
      });
      greeted += outcome.sent;
    }
  }

  const hr = await recipients.usersWithPermission("employee.view");
  await notifications.notify({
    template: "birthday_today",
    recipients: hr,
    organization,
    data: { names: people.map(fullName).join(", ") },
    severity: "info",
  });

  return { count: people.length, greeted };
}

async function anniversariesToday(today, timezone, organization) {
  const monthDay = today.slice(5);
  const year = Number(today.slice(0, 4));
  const people = await Employee.aggregate([
    { $match: { status: { $in: ACTIVE }, "employment.joiningDate": { $ne: null } } },
    {
      $addFields: {
        md: { $dateToString: { date: "$employment.joiningDate", format: "%m-%d", timezone } },
        joinYear: { $year: { date: "$employment.joiningDate", timezone } },
      },
    },
    { $match: { md: monthDay } },
    { $project: { userId: 1, personal: 1, joinYear: 1 } },
  ]);
  const celebrating = people.filter((p) => year - p.joinYear >= 1);
  if (!celebrating.length) return { count: 0 };

  let notified = 0;
  for (const employee of celebrating) {
    const outcome = await notifications.notify({
      template: "work_anniversary",
      recipients: [recipients.employeeToRecipient(employee)],
      organization,
      data: { employee: { firstName: employee.personal.firstName }, years: year - employee.joinYear },
      severity: "success",
      entity: { type: "Employee", id: employee._id },
    });
    notified += outcome.sent;
  }
  return { count: celebrating.length, notified };
}

/**
 * Probation reviews. Fires at the reminder threshold and again on the day,
 * not every day in between — the same person being nagged daily for a
 * fortnight trains everyone to ignore it.
 */
async function probationEnding(today, organization) {
  const reminderDays = Number(await settings.get("notification.probation_reminder_days").catch(() => 14)) || 14;
  const defaultMonths = Number(await settings.get("employee.probation_months").catch(() => 3)) || 0;

  const candidates = await Employee.find({
    status: "active",
    "employment.confirmationDate": null,
    "employment.joiningDate": { $ne: null },
  })
    .select("userId personal employment.joiningDate employment.probationMonths employment.managerId employment.designationId")
    .populate("employment.designationId", "name")
    .lean();

  let notified = 0;
  const hr = await recipients.usersWithPermission("employee.update");

  for (const employee of candidates) {
    const months = employee.employment.probationMonths ?? defaultMonths;
    if (!months) continue;
    const start = dt.toDateString(employee.employment.joiningDate, organization && organization.timezone);
    const end = addMonths(start, months);
    const daysLeft = dt.daysBetween(today, end);
    if (daysLeft !== reminderDays && daysLeft !== 0) continue;

    const manager = await recipients.managerOf(employee);
    const audience = [...hr, ...(manager ? [manager] : [])];
    const outcome = await notifications.notify({
      template: "probation_ending",
      recipients: audience,
      organization,
      data: {
        employee: {
          id: String(employee._id),
          name: fullName(employee),
          designation: (employee.employment.designationId && employee.employment.designationId.name) || "—",
        },
        probation: { endsOn: end, when: daysLeft === 0 ? "today" : `in ${daysLeft} days`, daysLeft },
      },
      severity: daysLeft === 0 ? "warning" : "info",
      entity: { type: "Employee", id: employee._id },
    });
    notified += outcome.sent;
  }
  return { checked: candidates.length, notified };
}

function addMonths(dateString, months) {
  const [y, m, d] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, d));
  // Clamp 31 Jan + 1 month to 28/29 Feb rather than rolling into March.
  if (date.getUTCDate() !== d) date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

async function leaveStartingTomorrow(today, organization) {
  const tomorrow = dt.addDays(today, 1);
  const days = await LeaveDay.find({ date: tomorrow, status: "approved", deductedDays: { $gt: 0 } })
    .populate("leaveRequestId", "fromDate toDate")
    .lean();
  if (!days.length) return { count: 0 };

  // Only the first day of a request counts as "starting".
  const starting = days.filter((d) => d.leaveRequestId && d.leaveRequestId.fromDate === tomorrow);
  if (!starting.length) return { count: 0 };

  const employees = await Employee.find({ _id: { $in: starting.map((d) => d.employeeId) } })
    .select("personal employment.managerId")
    .lean();
  const types = await LeaveType.find({ _id: { $in: starting.map((d) => d.leaveTypeId) } }).select("name").lean();
  const typeName = Object.fromEntries(types.map((t) => [String(t._id), t.name]));
  const byEmployee = Object.fromEntries(employees.map((e) => [String(e._id), e]));

  let notified = 0;
  for (const day of starting) {
    const employee = byEmployee[String(day.employeeId)];
    if (!employee) continue;
    const manager = await recipients.managerOf(employee);
    if (!manager) continue;
    const outcome = await notifications.notify({
      template: "leave_starting_tomorrow",
      recipients: [manager],
      organization,
      data: {
        employee: { id: String(employee._id), name: fullName(employee) },
        leave: {
          type: typeName[String(day.leaveTypeId)] || "leave",
          from: day.leaveRequestId.fromDate,
          to: day.leaveRequestId.toDate,
        },
      },
      entity: { type: "LeaveRequest", id: day.leaveRequestId._id },
    });
    notified += outcome.sent;
  }
  return { count: starting.length, notified };
}

async function holidayTomorrow(today, organization) {
  const enabled = await settings.get("notification.holiday_reminder").catch(() => true);
  if (!enabled) return { skipped: true };

  const holidayService = require("../holidays/holiday.service");
  const tomorrow = dt.addDays(today, 1);
  const cache = await holidayService.buildHolidayCache({ fromDate: tomorrow, toDate: tomorrow });

  const employees = await Employee.find({ status: { $in: ACTIVE }, userId: { $ne: null } })
    .select("userId personal employment.locationId employment.holidayCalendarId")
    .lean();

  const byHoliday = new Map();
  for (const employee of employees) {
    const holiday = await holidayService.holidayFor(employee, tomorrow, cache).catch(() => null);
    if (!holiday || holiday.isOptional) continue;
    const key = holiday.name;
    if (!byHoliday.has(key)) byHoliday.set(key, []);
    byHoliday.get(key).push(recipients.employeeToRecipient(employee));
  }

  let notified = 0;
  for (const [name, audience] of byHoliday.entries()) {
    const outcome = await notifications.notify({
      template: "holiday_tomorrow",
      recipients: audience,
      organization,
      data: { holiday: { name, date: tomorrow } },
      severity: "success",
    });
    notified += outcome.sent;
  }
  return { holidays: byHoliday.size, notified };
}

async function absentYesterday(today, organization) {
  const enabled = await settings.get("notification.notify_on_absent").catch(() => true);
  if (!enabled) return { skipped: true };

  const yesterday = dt.addDays(today, -1);
  const records = await AttendanceRecord.find({ date: yesterday, status: "absent", isManualOverride: false })
    .select("employeeId")
    .lean();
  if (!records.length) return { count: 0 };

  const employees = await Employee.find({
    _id: { $in: records.map((r) => r.employeeId) },
    status: { $in: ACTIVE },
    userId: { $ne: null },
    "employment.isAttendanceExempt": { $ne: true },
  })
    .select("userId personal")
    .lean();

  let notified = 0;
  for (const employee of employees) {
    const outcome = await notifications.notify({
      template: "absent_unmarked",
      recipients: [recipients.employeeToRecipient(employee)],
      organization,
      data: { attendance: { date: yesterday }, employee: { name: employee.personal.firstName } },
      severity: "warning",
      entity: { type: "AttendanceRecord", id: null },
    });
    notified += outcome.sent;
  }
  return { count: employees.length, notified };
}

/** Once a month, tell people whose balance has dipped below the threshold. */
async function leaveBalanceLow(today, organization) {
  if (today.slice(8) !== "01") return { skipped: true };
  const threshold = Number(await settings.get("notification.leave_balance_low_threshold").catch(() => 2));
  if (!threshold) return { skipped: true };

  const leaveService = require("../leave/leave.service");
  const employees = await Employee.find({ status: { $in: ACTIVE }, userId: { $ne: null } })
    .select("userId personal employment")
    .lean();

  let notified = 0;
  for (const employee of employees) {
    const balances = await leaveService.balancesFor(employee._id, today).catch(() => []);
    for (const balance of balances) {
      if (!balance.hasBalance || !balance.eligible) continue;
      if (balance.available === null || balance.available > threshold || balance.available < 0) continue;
      const outcome = await notifications.notify({
        template: "leave_balance_low",
        recipients: [recipients.employeeToRecipient(employee)],
        organization,
        data: { leave: { type: balance.leaveType.name, available: balance.available } },
      });
      notified += outcome.sent;
    }
  }
  return { notified };
}

module.exports = { run, joinersToday, birthdaysToday, anniversariesToday, probationEnding, leaveStartingTomorrow, holidayTomorrow, absentYesterday, leaveBalanceLow, addMonths };
