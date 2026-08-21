"use strict";

const Employee = require("../employees/employee.model");
const { AttendanceRecord } = require("../attendance/attendance.model");
const { LeaveRequest, LeaveDay } = require("../leave/leave.model");
const { AttendanceCorrection } = require("../attendance/attendance.model");
const attendanceService = require("../attendance/attendance.service");
const holidayService = require("../holidays/holiday.service");
const employeeService = require("../employees/employee.service");
const dt = require("../../shared/datetime");

/**
 * Dashboard aggregation.
 *
 * Every figure here is produced by an aggregation pipeline rather than by
 * loading documents and counting them in JavaScript, so the dashboard stays
 * flat as an organization grows from 30 employees to 3,000.
 *
 * Widgets are assembled individually and in parallel: a slow or failing widget
 * degrades to null instead of taking the whole dashboard down with it.
 */

async function hrDashboard(auth) {
  const timezone = await attendanceService.organizationTimezone();
  const today = dt.todayString(timezone);

  const [attendance, headcount, pendingApprovals, upcoming, trend, departmentSplit, leaveToday] =
    await Promise.all([
      attendanceService.todaySnapshot().catch(() => null),
      employeeService.headcountStats().catch(() => null),
      pendingApprovalCounts(auth).catch(() => null),
      upcomingEvents(today, timezone).catch(() => null),
      attendanceTrend(today, 30).catch(() => null),
      departmentDistribution().catch(() => null),
      whoIsOffToday(today).catch(() => null),
    ]);

  return {
    date: today,
    attendance,
    headcount,
    pendingApprovals,
    upcoming,
    trend,
    departmentSplit,
    onLeaveToday: leaveToday,
  };
}

async function pendingApprovalCounts(auth) {
  const permissions = auth.permissions || [];
  const out = { leave: 0, attendanceCorrections: 0, total: 0 };

  if (permissions.includes("leave.approve")) {
    out.leave = await LeaveRequest.countDocuments({ status: "pending" });
  }
  if (permissions.includes("attendance.approve")) {
    out.attendanceCorrections = await AttendanceCorrection.countDocuments({ status: "pending" });
    out.overtime = await AttendanceRecord.countDocuments({ overtimeStatus: "pending" });
  }

  out.total = out.leave + out.attendanceCorrections + (out.overtime || 0);
  return out;
}

async function upcomingEvents(today, timezone) {
  const in30Days = dt.addDays(today, 30);
  const in7Days = dt.addDays(today, 7);

  const [joiners, birthdays, anniversaries, holidays, exits] = await Promise.all([
    Employee.find({
      "employment.joiningDate": {
        $gte: dt.startOfDay(today, timezone),
        $lte: dt.endOfDay(in30Days, timezone),
      },
      status: { $in: ["active", "invited", "draft"] },
    })
      .select("employeeCode personal.firstName personal.lastName employment.joiningDate employment.designationId")
      .populate("employment.designationId", "name")
      .sort({ "employment.joiningDate": 1 })
      .limit(20)
      .lean(),

    // Birthdays ignore the year, so this compares month and day only.
    Employee.aggregate([
      {
        $match: {
          status: { $in: ["active", "on_leave", "notice_period"] },
          "personal.dateOfBirth": { $ne: null },
        },
      },
      {
        $addFields: {
          birthMonthDay: {
            $dateToString: { date: "$personal.dateOfBirth", format: "%m-%d", timezone },
          },
        },
      },
      { $match: { birthMonthDay: { $gte: today.slice(5), $lte: in30Days.slice(5) } } },
      { $sort: { birthMonthDay: 1 } },
      { $limit: 20 },
      {
        $project: {
          employeeCode: 1,
          name: { $concat: ["$personal.firstName", " ", { $ifNull: ["$personal.lastName", ""] }] },
          date: "$birthMonthDay",
          avatarFileId: 1,
        },
      },
    ]),

    Employee.aggregate([
      {
        $match: {
          status: { $in: ["active", "on_leave", "notice_period"] },
          "employment.joiningDate": { $ne: null },
        },
      },
      {
        $addFields: {
          joinMonthDay: {
            $dateToString: { date: "$employment.joiningDate", format: "%m-%d", timezone },
          },
          years: {
            $dateDiff: { startDate: "$employment.joiningDate", endDate: "$$NOW", unit: "year" },
          },
        },
      },
      { $match: { joinMonthDay: { $gte: today.slice(5), $lte: in7Days.slice(5) }, years: { $gte: 1 } } },
      { $sort: { joinMonthDay: 1 } },
      { $limit: 20 },
      {
        $project: {
          employeeCode: 1,
          name: { $concat: ["$personal.firstName", " ", { $ifNull: ["$personal.lastName", ""] }] },
          date: "$joinMonthDay",
          years: 1,
        },
      },
    ]),

    holidayService.listHolidays({ fromDate: today, toDate: in30Days }).catch(() => []),

    Employee.find({
      "exit.lastWorkingDay": {
        $gte: dt.startOfDay(today, timezone),
        $lte: dt.endOfDay(in30Days, timezone),
      },
      status: { $in: ["notice_period", "resigned"] },
    })
      .select("employeeCode personal.firstName personal.lastName exit.lastWorkingDay")
      .sort({ "exit.lastWorkingDay": 1 })
      .limit(20)
      .lean(),
  ]);

  return { joiners, birthdays, anniversaries, holidays: holidays.slice(0, 10), exits };
}

/** Daily attendance percentage over the last N days. */
async function attendanceTrend(today, days) {
  const from = dt.addDays(today, -days);

  const rows = await AttendanceRecord.aggregate([
    { $match: { date: { $gte: from, $lte: today } } },
    {
      $group: {
        _id: "$date",
        present: {
          $sum: {
            $cond: [{ $in: ["$status", ["present", "work_from_home", "on_duty"]] }, 1, 0],
          },
        },
        halfDay: { $sum: { $cond: [{ $eq: ["$status", "half_day"] }, 1, 0] } },
        absent: { $sum: { $cond: [{ $eq: ["$status", "absent"] }, 1, 0] } },
        leave: { $sum: { $cond: [{ $eq: ["$status", "leave"] }, 1, 0] } },
        late: { $sum: { $cond: ["$isLate", 1, 0] } },
        working: {
          $sum: {
            $cond: [{ $in: ["$status", ["weekly_off", "holiday", "not_applicable"]] }, 0, 1],
          },
        },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return rows.map((r) => ({
    date: r._id,
    present: r.present,
    halfDay: r.halfDay,
    absent: r.absent,
    leave: r.leave,
    late: r.late,
    attendancePercent: r.working ? Math.round(((r.present + r.halfDay * 0.5) / r.working) * 100) : null,
  }));
}

async function departmentDistribution() {
  return Employee.aggregate([
    { $match: { status: { $in: ["active", "on_leave", "notice_period"] } } },
    { $group: { _id: "$employment.departmentId", count: { $sum: 1 } } },
    { $lookup: { from: "departments", localField: "_id", foreignField: "_id", as: "d" } },
    {
      $project: {
        _id: 0,
        departmentId: "$_id",
        name: { $ifNull: [{ $first: "$d.name" }, "Unassigned"] },
        count: 1,
      },
    },
    { $sort: { count: -1 } },
    { $limit: 12 },
  ]);
}

async function whoIsOffToday(today) {
  const days = await LeaveDay.find({ date: today, status: "approved", deductedDays: { $gt: 0 } })
    .populate([
      { path: "employeeId", select: "employeeCode personal.firstName personal.lastName avatarFileId" },
      { path: "leaveTypeId", select: "name colour" },
    ])
    .limit(50)
    .lean();

  return days
    .filter((d) => d.employeeId)
    .map((d) => ({
      employeeId: String(d.employeeId._id),
      employeeCode: d.employeeId.employeeCode,
      name: [d.employeeId.personal.firstName, d.employeeId.personal.lastName].filter(Boolean).join(" "),
      leaveType: d.leaveTypeId ? d.leaveTypeId.name : "Leave",
      colour: d.leaveTypeId ? d.leaveTypeId.colour : "#6366F1",
      portion: d.dayPortion,
    }));
}

/** The employee portal's home screen. */
async function myDashboard(auth) {
  if (!auth.employeeId) return { hasEmployeeRecord: false };

  const timezone = await attendanceService.organizationTimezone();
  const today = dt.todayString(timezone);
  const monthStart = `${today.slice(0, 7)}-01`;

  const leaveService = require("../leave/leave.service");

  const [todayRecord, monthSummary, balances, pendingLeave, holidays, employee] = await Promise.all([
    AttendanceRecord.findOne({ employeeId: auth.employeeId, date: today }).lean(),
    attendanceService.summaryFor(auth.employeeId, monthStart, today),
    leaveService.balancesFor(auth.employeeId, today).catch(() => []),
    LeaveRequest.find({ employeeId: auth.employeeId, status: "pending" })
      .populate("leaveTypeId", "name colour")
      .sort({ createdAt: -1 })
      .limit(5)
      .lean(),
    Employee.findById(auth.employeeId)
      .lean()
      .then((e) => (e ? holidayService.forEmployee(e, Number(today.slice(0, 4))) : null))
      .catch(() => null),
    Employee.findById(auth.employeeId)
      .select("employeeCode personal employment avatarFileId status")
      .populate([
        { path: "employment.departmentId", select: "name" },
        { path: "employment.designationId", select: "name" },
        { path: "employment.shiftId", select: "name startTime endTime" },
        { path: "employment.managerId", select: "employeeCode personal.firstName personal.lastName" },
      ])
      .lean(),
  ]);

  const upcomingHolidays = holidays
    ? holidays.holidays.filter((h) => h.date >= today).slice(0, 5)
    : [];

  return {
    hasEmployeeRecord: true,
    date: today,
    employee,
    today: todayRecord,
    // Whether the next tap is a check-in or a check-out.
    nextPunchDirection: !todayRecord || !todayRecord.firstPunchAt ? "in" : "out",
    monthSummary,
    leaveBalances: balances.filter((b) => b.hasBalance && b.eligible),
    pendingLeave,
    upcomingHolidays,
  };
}

/** The manager's team view. */
async function teamDashboard(auth) {
  if (!auth.employeeId) return { hasTeam: false };

  const timezone = await attendanceService.organizationTimezone();
  const today = dt.todayString(timezone);

  const team = await Employee.find({
    "employment.managerChain": auth.employeeId,
    status: { $in: ["active", "on_leave", "notice_period"] },
  })
    .select("employeeCode personal.firstName personal.lastName avatarFileId employment.designationId")
    .populate("employment.designationId", "name")
    .lean();

  if (!team.length) return { hasTeam: false, teamSize: 0 };

  const teamIds = team.map((t) => t._id);

  const [records, pendingLeave, pendingCorrections] = await Promise.all([
    AttendanceRecord.find({ employeeId: { $in: teamIds }, date: today }).lean(),
    LeaveRequest.find({ employeeId: { $in: teamIds }, status: "pending" })
      .populate([
        { path: "employeeId", select: "employeeCode personal.firstName personal.lastName" },
        { path: "leaveTypeId", select: "name colour" },
      ])
      .sort({ createdAt: -1 })
      .limit(20)
      .lean(),
    AttendanceCorrection.find({ employeeId: { $in: teamIds }, status: "pending" })
      .populate({ path: "employeeId", select: "employeeCode personal.firstName personal.lastName" })
      .limit(20)
      .lean(),
  ]);

  const byEmployee = Object.fromEntries(records.map((r) => [String(r.employeeId), r]));

  return {
    hasTeam: true,
    teamSize: team.length,
    date: today,
    members: team.map((member) => {
      const record = byEmployee[String(member._id)];
      return {
        id: String(member._id),
        employeeCode: member.employeeCode,
        name: [member.personal.firstName, member.personal.lastName].filter(Boolean).join(" "),
        designation: member.employment.designationId && member.employment.designationId.name,
        status: record ? record.status : "pending",
        checkIn: record ? record.firstPunchAt : null,
        isLate: record ? record.isLate : false,
      };
    }),
    pendingApprovals: { leave: pendingLeave, corrections: pendingCorrections },
    presentToday: records.filter((r) => ["present", "half_day", "work_from_home", "on_duty"].includes(r.status)).length,
    onLeaveToday: records.filter((r) => r.status === "leave").length,
    absentToday: records.filter((r) => r.status === "absent").length,
  };
}

module.exports = { hrDashboard, myDashboard, teamDashboard, attendanceTrend };
