"use strict";

const Employee = require("../employees/employee.model");
const { AttendanceRecord } = require("../attendance/attendance.model");
const { LeaveRequest, LeaveBalance, LeaveType } = require("../leave/leave.model");
const { PayrollItem, PayrollRun } = require("../payroll/payroll.model");
const { BiometricSyncLog } = require("../biometric/biometricEvent.model");
const dt = require("../../shared/datetime");

/**
 * The report registry.
 *
 * A report is a definition — id, filters, columns, and a `run` function — so
 * the report list, the filter form, the export and the permission check are
 * all derived from one place. Adding a report is adding an entry here; the API
 * and the UI need no other change.
 *
 * Every `run` receives filters that have already been validated, and returns
 * plain rows. Formatting for XLSX/CSV/PDF happens in the report service, so a
 * report never has to know which format it is being asked for.
 */

const money = (n) => Math.round((n || 0) * 100) / 100;

const REPORTS = [
  {
    id: "employee_directory",
    name: "Employee Directory",
    description: "Every employee with their department, designation and contact details.",
    category: "employee",
    permission: "employee.view",
    filters: ["departmentId", "locationId", "designationId", "status", "employmentType"],
    columns: [
      { key: "employeeCode", label: "Employee Code", width: 16 },
      { key: "name", label: "Name", width: 26 },
      { key: "designation", label: "Designation", width: 22 },
      { key: "department", label: "Department", width: 20 },
      { key: "location", label: "Location", width: 18 },
      { key: "employmentType", label: "Type", width: 14 },
      { key: "joiningDate", label: "Joining Date", width: 14, type: "date" },
      { key: "email", label: "Work Email", width: 28 },
      { key: "phone", label: "Phone", width: 16 },
      { key: "status", label: "Status", width: 14 },
    ],
    async run(filters) {
      const query = buildEmployeeFilter(filters);
      const rows = await Employee.find(query)
        .populate([
          { path: "employment.departmentId", select: "name" },
          { path: "employment.designationId", select: "name" },
          { path: "employment.locationId", select: "name" },
        ])
        .sort({ employeeCode: 1 })
        .lean();

      return rows.map((e) => ({
        employeeCode: e.employeeCode,
        name: [e.personal.firstName, e.personal.lastName].filter(Boolean).join(" "),
        designation: e.employment.designationId && e.employment.designationId.name,
        department: e.employment.departmentId && e.employment.departmentId.name,
        location: e.employment.locationId && e.employment.locationId.name,
        employmentType: String(e.employment.employmentType || "").replace(/_/g, " "),
        joiningDate: e.employment.joiningDate,
        email: e.personal.workEmail,
        phone: e.personal.phone,
        status: e.status,
      }));
    },
  },

  {
    id: "headcount_summary",
    name: "Headcount Summary",
    description: "Employee counts by department, location and employment type.",
    category: "employee",
    permission: "employee.view",
    filters: [],
    columns: [
      { key: "grouping", label: "Grouping", width: 20 },
      { key: "value", label: "Value", width: 28 },
      { key: "count", label: "Employees", width: 12, type: "number" },
    ],
    async run() {
      const active = { status: { $in: ["active", "on_leave", "notice_period"] } };

      const group = async (field, collection, label) => {
        const rows = await Employee.aggregate([
          { $match: active },
          { $group: { _id: `$${field}`, count: { $sum: 1 } } },
          { $lookup: { from: collection, localField: "_id", foreignField: "_id", as: "ref" } },
          {
            $project: {
              count: 1,
              value: { $ifNull: [{ $first: "$ref.name" }, "Unassigned"] },
            },
          },
          { $sort: { count: -1 } },
        ]);
        return rows.map((r) => ({ grouping: label, value: r.value, count: r.count }));
      };

      const [byDepartment, byLocation, byType] = await Promise.all([
        group("employment.departmentId", "departments", "Department"),
        group("employment.locationId", "locations", "Location"),
        Employee.aggregate([
          { $match: active },
          { $group: { _id: "$employment.employmentType", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]).then((rows) =>
          rows.map((r) => ({
            grouping: "Employment type",
            value: String(r._id || "Unspecified").replace(/_/g, " "),
            count: r.count,
          }))
        ),
      ]);

      return [...byDepartment, ...byLocation, ...byType];
    },
  },

  {
    id: "attendance_register",
    name: "Attendance Register",
    description: "Day-by-day attendance for a date range.",
    category: "attendance",
    permission: "attendance.view",
    filters: ["fromDate", "toDate", "departmentId", "locationId", "employeeId", "status"],
    requiresDateRange: true,
    columns: [
      { key: "date", label: "Date", width: 12 },
      { key: "employeeCode", label: "Employee Code", width: 16 },
      { key: "name", label: "Name", width: 26 },
      { key: "department", label: "Department", width: 20 },
      { key: "status", label: "Status", width: 14 },
      { key: "checkIn", label: "Check In", width: 12 },
      { key: "checkOut", label: "Check Out", width: 12 },
      { key: "workedHours", label: "Worked Hours", width: 14, type: "number" },
      { key: "lateBy", label: "Late By (min)", width: 14, type: "number" },
      { key: "overtimeHours", label: "OT Hours", width: 12, type: "number" },
      { key: "payableDays", label: "Payable", width: 10, type: "number" },
    ],
    async run(filters, context) {
      const employees = await Employee.find(buildEmployeeFilter(filters)).select("employeeCode personal employment.departmentId").populate("employment.departmentId", "name").lean();
      const byId = Object.fromEntries(employees.map((e) => [String(e._id), e]));

      const records = await AttendanceRecord.find({
        employeeId: { $in: employees.map((e) => e._id) },
        date: { $gte: filters.fromDate, $lte: filters.toDate },
        ...(filters.status ? { status: filters.status } : {}),
      })
        .sort({ date: 1 })
        .limit(100000)
        .lean();

      return records.map((r) => {
        const employee = byId[String(r.employeeId)] || {};
        return {
          date: r.date,
          employeeCode: employee.employeeCode,
          name: employee.personal
            ? [employee.personal.firstName, employee.personal.lastName].filter(Boolean).join(" ")
            : "",
          department:
            employee.employment && employee.employment.departmentId
              ? employee.employment.departmentId.name
              : "",
          status: String(r.status || "").replace(/_/g, " "),
          checkIn: r.firstPunchAt ? formatTime(r.firstPunchAt, context.timezone) : "",
          checkOut: r.lastPunchAt ? formatTime(r.lastPunchAt, context.timezone) : "",
          workedHours: Math.round(((r.effectiveMinutes || 0) / 60) * 100) / 100,
          lateBy: r.lateByMinutes || 0,
          overtimeHours: Math.round(((r.overtimeMinutes || 0) / 60) * 100) / 100,
          payableDays: r.payableDays || 0,
        };
      });
    },
  },

  {
    id: "attendance_summary",
    name: "Monthly Attendance Summary",
    description: "Per-employee totals for a period: present, absent, leave, late and overtime.",
    category: "attendance",
    permission: "attendance.view",
    filters: ["fromDate", "toDate", "departmentId", "locationId"],
    requiresDateRange: true,
    columns: [
      { key: "employeeCode", label: "Employee Code", width: 16 },
      { key: "name", label: "Name", width: 26 },
      { key: "department", label: "Department", width: 20 },
      { key: "present", label: "Present", width: 10, type: "number" },
      { key: "halfDay", label: "Half Day", width: 10, type: "number" },
      { key: "absent", label: "Absent", width: 10, type: "number" },
      { key: "leave", label: "Leave", width: 10, type: "number" },
      { key: "weeklyOff", label: "Weekly Off", width: 12, type: "number" },
      { key: "holiday", label: "Holiday", width: 10, type: "number" },
      { key: "late", label: "Late Marks", width: 12, type: "number" },
      { key: "payableDays", label: "Payable Days", width: 14, type: "number" },
      { key: "overtimeHours", label: "OT Hours", width: 12, type: "number" },
    ],
    async run(filters) {
      const employees = await Employee.find(buildEmployeeFilter(filters))
        .select("employeeCode personal employment.departmentId")
        .populate("employment.departmentId", "name")
        .sort({ employeeCode: 1 })
        .lean();

      const attendanceService = require("../attendance/attendance.service");
      const out = [];

      for (const employee of employees) {
        const summary = await attendanceService.summaryFor(
          employee._id,
          filters.fromDate,
          filters.toDate
        );
        out.push({
          employeeCode: employee.employeeCode,
          name: [employee.personal.firstName, employee.personal.lastName].filter(Boolean).join(" "),
          department:
            employee.employment.departmentId && employee.employment.departmentId.name,
          present: summary.present,
          halfDay: summary.halfDay,
          absent: summary.absent,
          leave: summary.leave,
          weeklyOff: summary.weeklyOff,
          holiday: summary.holiday,
          late: summary.late,
          payableDays: summary.payableDays,
          overtimeHours: summary.overtimeHours,
        });
      }
      return out;
    },
  },

  {
    id: "late_arrivals",
    name: "Late Arrivals",
    description: "Every late mark in a period, with how late and by how much.",
    category: "attendance",
    permission: "attendance.view",
    filters: ["fromDate", "toDate", "departmentId"],
    requiresDateRange: true,
    columns: [
      { key: "date", label: "Date", width: 12 },
      { key: "employeeCode", label: "Employee Code", width: 16 },
      { key: "name", label: "Name", width: 26 },
      { key: "department", label: "Department", width: 20 },
      { key: "checkIn", label: "Check In", width: 12 },
      { key: "lateBy", label: "Late By (min)", width: 14, type: "number" },
      { key: "lateMarkNumber", label: "Late Mark #", width: 14, type: "number" },
    ],
    async run(filters, context) {
      const employees = await Employee.find(buildEmployeeFilter(filters))
        .select("employeeCode personal employment.departmentId")
        .populate("employment.departmentId", "name")
        .lean();
      const byId = Object.fromEntries(employees.map((e) => [String(e._id), e]));

      const records = await AttendanceRecord.find({
        employeeId: { $in: employees.map((e) => e._id) },
        date: { $gte: filters.fromDate, $lte: filters.toDate },
        isLate: true,
      })
        .sort({ date: -1 })
        .limit(50000)
        .lean();

      return records.map((r) => {
        const employee = byId[String(r.employeeId)] || {};
        return {
          date: r.date,
          employeeCode: employee.employeeCode,
          name: employee.personal
            ? [employee.personal.firstName, employee.personal.lastName].filter(Boolean).join(" ")
            : "",
          department:
            employee.employment && employee.employment.departmentId
              ? employee.employment.departmentId.name
              : "",
          checkIn: r.firstPunchAt ? formatTime(r.firstPunchAt, context.timezone) : "",
          lateBy: r.lateByMinutes,
          lateMarkNumber: r.lateMarkNumber || "",
        };
      });
    },
  },

  {
    id: "leave_register",
    name: "Leave Register",
    description: "All leave requests in a period with their status.",
    category: "leave",
    permission: "leave.view",
    filters: ["fromDate", "toDate", "departmentId", "leaveTypeId", "status"],
    requiresDateRange: true,
    columns: [
      { key: "employeeCode", label: "Employee Code", width: 16 },
      { key: "name", label: "Name", width: 26 },
      { key: "leaveType", label: "Leave Type", width: 20 },
      { key: "fromDate", label: "From", width: 12 },
      { key: "toDate", label: "To", width: 12 },
      { key: "days", label: "Days", width: 10, type: "number" },
      { key: "status", label: "Status", width: 14 },
      { key: "reason", label: "Reason", width: 40 },
      { key: "appliedOn", label: "Applied On", width: 14, type: "date" },
    ],
    async run(filters) {
      const employees = await Employee.find(buildEmployeeFilter(filters)).select("_id employeeCode personal").lean();

      const query = {
        employeeId: { $in: employees.map((e) => e._id) },
        fromDate: { $lte: filters.toDate },
        toDate: { $gte: filters.fromDate },
      };
      if (filters.status) query.status = filters.status;
      if (filters.leaveTypeId) query.leaveTypeId = filters.leaveTypeId;

      const rows = await LeaveRequest.find(query)
        .populate([
          { path: "employeeId", select: "employeeCode personal.firstName personal.lastName" },
          { path: "leaveTypeId", select: "name" },
        ])
        .sort({ fromDate: -1 })
        .limit(50000)
        .lean();

      return rows.map((r) => ({
        employeeCode: r.employeeId && r.employeeId.employeeCode,
        name:
          r.employeeId && r.employeeId.personal
            ? [r.employeeId.personal.firstName, r.employeeId.personal.lastName].filter(Boolean).join(" ")
            : "",
        leaveType: r.leaveTypeId && r.leaveTypeId.name,
        fromDate: r.fromDate,
        toDate: r.toDate,
        days: r.leaveDays,
        status: r.status,
        reason: r.reason,
        appliedOn: r.createdAt,
      }));
    },
  },

  {
    id: "leave_balances",
    name: "Leave Balances",
    description: "Current balance of every leave type for every employee.",
    category: "leave",
    permission: "leave.view",
    filters: ["departmentId", "leaveTypeId", "year"],
    columns: [
      { key: "employeeCode", label: "Employee Code", width: 16 },
      { key: "name", label: "Name", width: 26 },
      { key: "leaveType", label: "Leave Type", width: 20 },
      { key: "opening", label: "Opening", width: 10, type: "number" },
      { key: "allocated", label: "Allocated", width: 12, type: "number" },
      { key: "carriedForward", label: "Carried", width: 10, type: "number" },
      { key: "used", label: "Used", width: 10, type: "number" },
      { key: "pending", label: "Pending", width: 10, type: "number" },
      { key: "available", label: "Available", width: 12, type: "number" },
    ],
    async run(filters) {
      const employees = await Employee.find(buildEmployeeFilter(filters))
        .select("employeeCode personal")
        .lean();
      const byId = Object.fromEntries(employees.map((e) => [String(e._id), e]));

      const query = {
        employeeId: { $in: employees.map((e) => e._id) },
        year: filters.year || new Date().getFullYear(),
      };
      if (filters.leaveTypeId) query.leaveTypeId = filters.leaveTypeId;

      const [balances, types] = await Promise.all([
        LeaveBalance.find(query).lean(),
        LeaveType.find({}).select("name").lean(),
      ]);
      const typeById = Object.fromEntries(types.map((t) => [String(t._id), t.name]));

      return balances.map((b) => {
        const employee = byId[String(b.employeeId)] || {};
        const available =
          b.opening + b.allocated + b.carriedForward + b.credited + b.adjustment -
          b.used - b.pending - b.encashed - b.lapsed;
        return {
          employeeCode: employee.employeeCode,
          name: employee.personal
            ? [employee.personal.firstName, employee.personal.lastName].filter(Boolean).join(" ")
            : "",
          leaveType: typeById[String(b.leaveTypeId)] || "",
          opening: b.opening,
          allocated: b.allocated,
          carriedForward: b.carriedForward,
          used: b.used,
          pending: b.pending,
          available: Math.round(available * 100) / 100,
        };
      });
    },
  },

  {
    id: "payroll_register",
    name: "Payroll Register",
    description: "Gross, deductions and net for every employee in a payroll run.",
    category: "payroll",
    permission: "payroll.view",
    filters: ["runId"],
    requiresRun: true,
    columns: [
      { key: "employeeCode", label: "Employee Code", width: 16 },
      { key: "name", label: "Name", width: 26 },
      { key: "department", label: "Department", width: 20 },
      { key: "payableDays", label: "Payable Days", width: 14, type: "number" },
      { key: "lopDays", label: "LOP Days", width: 12, type: "number" },
      { key: "gross", label: "Gross", width: 14, type: "money" },
      { key: "deductions", label: "Deductions", width: 14, type: "money" },
      { key: "net", label: "Net Pay", width: 14, type: "money" },
    ],
    async run(filters) {
      if (!filters.runId) return [];
      const items = await PayrollItem.find({ runId: filters.runId })
        .sort({ "employeeSnapshot.employeeCode": 1 })
        .lean();

      return items.map((i) => ({
        employeeCode: i.employeeSnapshot.employeeCode,
        name: i.employeeSnapshot.name,
        department: i.employeeSnapshot.department,
        payableDays: i.attendance.payableDays,
        lopDays: i.attendance.lossOfPayDays,
        gross: money(i.gross),
        deductions: money(i.totalDeductions),
        net: money(i.net),
      }));
    },
  },

  {
    id: "bank_transfer",
    name: "Bank Transfer Statement",
    description: "Net payable per employee with bank details, for upload to the bank.",
    category: "payroll",
    permission: "payroll.export",
    filters: ["runId"],
    requiresRun: true,
    columns: [
      { key: "employeeCode", label: "Employee Code", width: 16 },
      { key: "name", label: "Beneficiary Name", width: 28 },
      { key: "accountNumber", label: "Account Number", width: 22 },
      { key: "ifsc", label: "IFSC / Sort Code", width: 16 },
      { key: "bankName", label: "Bank", width: 24 },
      { key: "amount", label: "Amount", width: 14, type: "money" },
    ],
    async run(filters) {
      if (!filters.runId) return [];
      const items = await PayrollItem.find({ runId: filters.runId, status: "calculated" }).lean();
      const employees = await Employee.find({ _id: { $in: items.map((i) => i.employeeId) } })
        .select("employeeCode bank")
        .lean();
      const byId = Object.fromEntries(employees.map((e) => [String(e._id), e]));

      return items
        .filter((i) => i.net > 0)
        .map((i) => {
          const employee = byId[String(i.employeeId)] || {};
          const bank = employee.bank || {};
          return {
            employeeCode: i.employeeSnapshot.employeeCode,
            name: bank.accountHolderName || i.employeeSnapshot.name,
            accountNumber: bank.accountNumber || "",
            ifsc: bank.ifscCode || bank.swiftCode || "",
            bankName: bank.bankName || "",
            amount: money(i.net),
          };
        });
    },
  },

  {
    id: "attrition",
    name: "Attrition Report",
    description: "Joiners and leavers by month, with the attrition rate.",
    category: "employee",
    permission: "employee.view",
    filters: ["fromDate", "toDate"],
    requiresDateRange: true,
    columns: [
      { key: "month", label: "Month", width: 14 },
      { key: "opening", label: "Opening", width: 12, type: "number" },
      { key: "joiners", label: "Joiners", width: 12, type: "number" },
      { key: "leavers", label: "Leavers", width: 12, type: "number" },
      { key: "closing", label: "Closing", width: 12, type: "number" },
      { key: "attritionRate", label: "Attrition %", width: 14, type: "number" },
    ],
    async run(filters) {
      const start = filters.fromDate.slice(0, 7);
      const end = filters.toDate.slice(0, 7);

      const months = [];
      let cursor = `${start}-01`;
      while (cursor.slice(0, 7) <= end && months.length < 60) {
        months.push(cursor.slice(0, 7));
        cursor = dt.addDays(dt.monthBounds(Number(cursor.slice(0, 4)), Number(cursor.slice(5, 7))).end, 1);
      }

      const rows = [];
      let opening = await Employee.countDocuments({
        "employment.joiningDate": { $lt: new Date(`${start}-01`) },
        status: { $in: ["active", "on_leave", "notice_period"] },
      });

      for (const month of months) {
        const bounds = dt.monthBounds(Number(month.slice(0, 4)), Number(month.slice(5, 7)));
        const [joiners, leavers] = await Promise.all([
          Employee.countDocuments({
            "employment.joiningDate": {
              $gte: new Date(`${bounds.start}T00:00:00Z`),
              $lte: new Date(`${bounds.end}T23:59:59Z`),
            },
          }),
          Employee.countDocuments({
            "exit.lastWorkingDay": {
              $gte: new Date(`${bounds.start}T00:00:00Z`),
              $lte: new Date(`${bounds.end}T23:59:59Z`),
            },
          }),
        ]);

        const closing = opening + joiners - leavers;
        const average = (opening + closing) / 2;
        rows.push({
          month,
          opening,
          joiners,
          leavers,
          closing,
          attritionRate: average ? Math.round((leavers / average) * 10000) / 100 : 0,
        });
        opening = closing;
      }

      return rows;
    },
  },

  {
    id: "biometric_sync",
    name: "Biometric Sync Report",
    description: "Device sync history with counts and failures.",
    category: "biometric",
    permission: "biometric.view",
    filters: ["fromDate", "toDate", "deviceId"],
    columns: [
      { key: "device", label: "Device", width: 22 },
      { key: "startedAt", label: "Started", width: 20, type: "date" },
      { key: "trigger", label: "Trigger", width: 12 },
      { key: "status", label: "Status", width: 12 },
      { key: "fetched", label: "Fetched", width: 10, type: "number" },
      { key: "created", label: "New", width: 10, type: "number" },
      { key: "duplicates", label: "Duplicates", width: 12, type: "number" },
      { key: "unmapped", label: "Unmapped", width: 12, type: "number" },
      { key: "punches", label: "Punches", width: 10, type: "number" },
      { key: "error", label: "Error", width: 40 },
    ],
    async run(filters) {
      const query = {};
      if (filters.deviceId) query.deviceId = filters.deviceId;
      if (filters.fromDate) {
        query.startedAt = { $gte: new Date(`${filters.fromDate}T00:00:00Z`) };
      }
      if (filters.toDate) {
        query.startedAt = { ...(query.startedAt || {}), $lte: new Date(`${filters.toDate}T23:59:59Z`) };
      }

      const rows = await BiometricSyncLog.find(query)
        .populate("deviceId", "name code")
        .sort({ startedAt: -1 })
        .limit(5000)
        .lean();

      return rows.map((r) => ({
        device: r.deviceId ? `${r.deviceId.name} (${r.deviceId.code})` : "",
        startedAt: r.startedAt,
        trigger: r.trigger,
        status: r.status,
        fetched: r.eventsFetched,
        created: r.eventsNew,
        duplicates: r.eventsDuplicate,
        unmapped: r.eventsUnmapped,
        punches: r.punchesCreated,
        error: r.error || "",
      }));
    },
  },
];

function buildEmployeeFilter(filters) {
  const query = {};

  if (filters.status) query.status = filters.status;
  else query.status = { $in: ["active", "on_leave", "notice_period", "suspended"] };

  if (filters.departmentId) query["employment.departmentId"] = filters.departmentId;
  if (filters.locationId) query["employment.locationId"] = filters.locationId;
  if (filters.designationId) query["employment.designationId"] = filters.designationId;
  if (filters.employmentType) query["employment.employmentType"] = filters.employmentType;
  if (filters.employeeId) query._id = filters.employeeId;

  return query;
}

function formatTime(instant, timezone) {
  return dt.dayjs(instant).tz(timezone || dt.DEFAULT_TZ).format("HH:mm");
}

const REPORTS_BY_ID = Object.fromEntries(REPORTS.map((r) => [r.id, r]));

module.exports = { REPORTS, REPORTS_BY_ID, buildEmployeeFilter };
