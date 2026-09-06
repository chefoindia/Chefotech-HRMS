"use strict";

const Employee = require("../employees/employee.model");
const { AttendanceRecord } = require("../attendance/attendance.model");
const { LeaveRequest, LeaveBalance, LeaveType } = require("../leave/leave.model");
const { PayrollItem, PayrollRun, PayrollPeriod, EmployeeSalary, SalaryComponent, Payslip } = require("../payroll/payroll.model");
const dt = require("../../shared/datetime");

/**
 * The data sources a sheet template can be built on.
 *
 * Each source declares the fields it offers (the column picker in the
 * designer reads this) and a `rows()` that produces plain objects keyed by
 * those fields. Formatting, totals and grouping are the renderer's job; a
 * source never knows whether it is becoming XLSX or PDF.
 *
 * Fields are flat and predictable on purpose: a formula in a column can say
 * "BASIC + HRA" because every salary component is a top-level field named by
 * its code.
 */

const ACTIVE = ["active", "on_leave", "notice_period"];

const employeeFields = [
  { key: "employeeCode", label: "Employee code", type: "text" },
  { key: "name", label: "Name", type: "text" },
  { key: "firstName", label: "First name", type: "text" },
  { key: "lastName", label: "Last name", type: "text" },
  { key: "gender", label: "Gender", type: "text" },
  { key: "dateOfBirth", label: "Date of birth", type: "date" },
  { key: "department", label: "Department", type: "text" },
  { key: "designation", label: "Designation", type: "text" },
  { key: "grade", label: "Grade", type: "text" },
  { key: "location", label: "Location", type: "text" },
  { key: "manager", label: "Reporting manager", type: "text" },
  { key: "employmentType", label: "Employment type", type: "text" },
  { key: "workMode", label: "Work mode", type: "text" },
  { key: "joiningDate", label: "Joining date", type: "date" },
  { key: "confirmationDate", label: "Confirmation date", type: "date" },
  { key: "status", label: "Status", type: "text" },
  { key: "workEmail", label: "Work email", type: "text" },
  { key: "personalEmail", label: "Personal email", type: "text" },
  { key: "phone", label: "Phone", type: "text" },
  { key: "fatherName", label: "Father's name", type: "text" },
  { key: "bloodGroup", label: "Blood group", type: "text" },
  { key: "address", label: "Current address", type: "text" },
  { key: "city", label: "City", type: "text" },
  { key: "state", label: "State", type: "text" },
  { key: "postalCode", label: "Postal code", type: "text" },
  { key: "pan", label: "PAN", type: "text", sensitive: true },
  { key: "aadhaar", label: "Aadhaar", type: "text", sensitive: true },
  { key: "passport", label: "Passport", type: "text", sensitive: true },
  { key: "uan", label: "UAN", type: "text", sensitive: true },
  { key: "pfNumber", label: "PF number", type: "text", sensitive: true },
  { key: "esiNumber", label: "ESI number", type: "text", sensitive: true },
  { key: "pfApplicable", label: "PF applicable", type: "boolean", sensitive: true },
  { key: "esiApplicable", label: "ESI applicable", type: "boolean", sensitive: true },
  { key: "bankName", label: "Bank", type: "text", sensitive: true },
  { key: "accountHolderName", label: "Account holder", type: "text", sensitive: true },
  { key: "accountNumber", label: "Account number", type: "text", sensitive: true },
  { key: "ifscCode", label: "IFSC", type: "text", sensitive: true },
  { key: "paymentMode", label: "Payment mode", type: "text", sensitive: true },
  { key: "biometricId", label: "Biometric id", type: "text" },
  { key: "shift", label: "Shift", type: "text" },
  { key: "lastWorkingDay", label: "Last working day", type: "date" },
  { key: "exitType", label: "Exit type", type: "text" },
  { key: "tenureMonths", label: "Tenure (months)", type: "integer" },
  { key: "age", label: "Age", type: "integer" },
];

function employeeRow(e, timezone) {
  const p = e.personal || {};
  const emp = e.employment || {};
  const addr = p.currentAddress || {};
  const idDoc = (type) => ((e.identityDocuments || []).find((d) => String(d.type).toLowerCase() === type) || {}).number || "";
  const bank = e.bank || {};
  const stat = e.statutory || {};
  const joining = emp.joiningDate ? dt.toDateString(emp.joiningDate, timezone) : null;
  const dob = p.dateOfBirth ? dt.toDateString(p.dateOfBirth, timezone) : null;
  const today = dt.todayString(timezone);
  return {
    _id: e._id,
    employeeCode: e.employeeCode,
    name: [p.firstName, p.middleName, p.lastName].filter(Boolean).join(" "),
    firstName: p.firstName,
    lastName: p.lastName,
    gender: p.gender,
    dateOfBirth: dob,
    department: emp.departmentId && emp.departmentId.name,
    designation: emp.designationId && emp.designationId.name,
    grade: emp.designationId && emp.designationId.grade,
    location: emp.locationId && emp.locationId.name,
    manager: emp.managerId && emp.managerId.personal ? [emp.managerId.personal.firstName, emp.managerId.personal.lastName].filter(Boolean).join(" ") : "",
    employmentType: String(emp.employmentType || "").replace(/_/g, " "),
    workMode: String(emp.workMode || "").replace(/_/g, " "),
    joiningDate: joining,
    confirmationDate: emp.confirmationDate ? dt.toDateString(emp.confirmationDate, timezone) : null,
    status: e.status,
    workEmail: p.workEmail,
    personalEmail: p.personalEmail,
    phone: p.phone,
    fatherName: p.fatherName,
    bloodGroup: p.bloodGroup,
    address: [addr.line1, addr.line2].filter(Boolean).join(", "),
    city: addr.city,
    state: addr.state,
    postalCode: addr.postalCode,
    pan: stat.taxId || idDoc("pan"),
    aadhaar: idDoc("aadhaar"),
    passport: idDoc("passport"),
    uan: stat.uan,
    pfNumber: stat.pfNumber,
    esiNumber: stat.esiNumber,
    pfApplicable: Boolean(stat.pfApplicable),
    esiApplicable: Boolean(stat.esiApplicable),
    bankName: bank.bankName,
    accountHolderName: bank.accountHolderName,
    accountNumber: bank.accountNumber,
    ifscCode: bank.ifscCode,
    paymentMode: bank.paymentMode,
    biometricId: e.biometricId,
    shift: emp.shiftId && emp.shiftId.name,
    lastWorkingDay: e.exit && e.exit.lastWorkingDay ? dt.toDateString(e.exit.lastWorkingDay, timezone) : null,
    exitType: e.exit && e.exit.exitType,
    tenureMonths: joining ? dt.monthsSince(joining, today) : null,
    age: dob ? dt.yearsSince(dob, today) : null,
  };
}

function employeeQuery(filters) {
  const query = {};
  query.status = filters.status ? filters.status : { $in: [...ACTIVE, "suspended"] };
  if (filters.includeInactive) delete query.status;
  if (filters.departmentId) query["employment.departmentId"] = filters.departmentId;
  if (filters.locationId) query["employment.locationId"] = filters.locationId;
  if (filters.designationId) query["employment.designationId"] = filters.designationId;
  if (filters.employmentType) query["employment.employmentType"] = filters.employmentType;
  if (filters.employeeIds && filters.employeeIds.length) query._id = { $in: filters.employeeIds };
  return query;
}

async function loadEmployees(filters) {
  return Employee.find(employeeQuery(filters))
    .populate([
      { path: "employment.departmentId", select: "name" },
      { path: "employment.designationId", select: "name grade" },
      { path: "employment.locationId", select: "name" },
      { path: "employment.managerId", select: "personal.firstName personal.lastName" },
      { path: "employment.shiftId", select: "name" },
    ])
    .sort({ employeeCode: 1 })
    .lean();
}

const SOURCES = {
  employees: {
    label: "Employee master",
    description: "One row per employee, with everything on the record.",
    permission: "employee.view",
    sensitivePermission: "employee.view_sensitive",
    filters: ["departmentId", "locationId", "designationId", "employmentType", "status"],
    fields: employeeFields,
    async rows(filters, ctx) {
      const employees = await loadEmployees(filters);
      return employees.map((e) => employeeRow(e, ctx.timezone));
    },
  },

  attendance_daily: {
    label: "Attendance — daily",
    description: "One row per employee per day in the period.",
    permission: "attendance.view",
    filters: ["fromDate", "toDate", "departmentId", "locationId", "employeeIds"],
    requiresDateRange: true,
    fields: [
      { key: "date", label: "Date", type: "date" },
      { key: "employeeCode", label: "Employee code", type: "text" },
      { key: "name", label: "Name", type: "text" },
      { key: "department", label: "Department", type: "text" },
      { key: "designation", label: "Designation", type: "text" },
      { key: "shift", label: "Shift", type: "text" },
      { key: "status", label: "Status", type: "text" },
      { key: "checkIn", label: "Check in", type: "text" },
      { key: "checkOut", label: "Check out", type: "text" },
      { key: "workedHours", label: "Worked hours", type: "number" },
      { key: "breakMinutes", label: "Break (min)", type: "integer" },
      { key: "lateBy", label: "Late by (min)", type: "integer" },
      { key: "earlyBy", label: "Early leaving (min)", type: "integer" },
      { key: "overtimeHours", label: "OT hours", type: "number" },
      { key: "overtimeStatus", label: "OT status", type: "text" },
      { key: "payableDays", label: "Payable days", type: "number" },
      { key: "isLate", label: "Late", type: "boolean" },
      { key: "isMissingPunch", label: "Missing punch", type: "boolean" },
      { key: "holidayName", label: "Holiday", type: "text" },
      { key: "leaveType", label: "Leave type", type: "text" },
    ],
    async rows(filters, ctx) {
      const employees = await loadEmployees(filters);
      const byId = Object.fromEntries(employees.map((e) => [String(e._id), e]));
      const records = await AttendanceRecord.find({
        employeeId: { $in: employees.map((e) => e._id) },
        date: { $gte: filters.fromDate, $lte: filters.toDate },
      })
        .sort({ date: 1 })
        .limit(200000)
        .lean();

      return records.map((r) => {
        const e = byId[String(r.employeeId)] || {};
        const emp = e.employment || {};
        return {
          date: r.date,
          employeeCode: e.employeeCode,
          name: e.personal ? [e.personal.firstName, e.personal.lastName].filter(Boolean).join(" ") : "",
          department: emp.departmentId && emp.departmentId.name,
          designation: emp.designationId && emp.designationId.name,
          shift: r.shiftCode,
          status: String(r.status || "").replace(/_/g, " "),
          checkIn: r.firstPunchAt ? dt.dayjs(r.firstPunchAt).tz(ctx.timezone).format("HH:mm") : "",
          checkOut: r.lastPunchAt ? dt.dayjs(r.lastPunchAt).tz(ctx.timezone).format("HH:mm") : "",
          workedHours: Math.round(((r.effectiveMinutes || 0) / 60) * 100) / 100,
          breakMinutes: r.breakMinutes || 0,
          lateBy: r.lateByMinutes || 0,
          earlyBy: r.earlyLeavingByMinutes || 0,
          overtimeHours: Math.round(((r.overtimeMinutes || 0) / 60) * 100) / 100,
          overtimeStatus: r.overtimeStatus,
          payableDays: r.payableDays || 0,
          isLate: Boolean(r.isLate),
          isMissingPunch: Boolean(r.isMissingPunch),
          holidayName: r.holidayName || "",
          leaveType: r.leaveType || "",
        };
      });
    },
  },

  attendance_monthly: {
    label: "Attendance — monthly summary",
    description: "One row per employee with totals for the period.",
    permission: "attendance.view",
    filters: ["fromDate", "toDate", "departmentId", "locationId", "employeeIds"],
    requiresDateRange: true,
    fields: [
      { key: "employeeCode", label: "Employee code", type: "text" },
      { key: "name", label: "Name", type: "text" },
      { key: "department", label: "Department", type: "text" },
      { key: "designation", label: "Designation", type: "text" },
      { key: "location", label: "Location", type: "text" },
      { key: "totalDays", label: "Days in period", type: "integer" },
      { key: "present", label: "Present", type: "number" },
      { key: "halfDay", label: "Half days", type: "integer" },
      { key: "absent", label: "Absent", type: "number" },
      { key: "leave", label: "Leave", type: "number" },
      { key: "weeklyOff", label: "Weekly off", type: "integer" },
      { key: "holiday", label: "Holidays", type: "integer" },
      { key: "late", label: "Late marks", type: "integer" },
      { key: "earlyLeaving", label: "Early leaving", type: "integer" },
      { key: "missingPunch", label: "Missing punches", type: "integer" },
      { key: "payableDays", label: "Payable days", type: "number" },
      { key: "workedHours", label: "Worked hours", type: "number" },
      { key: "overtimeHours", label: "OT hours (approved)", type: "number" },
      { key: "compOffEarned", label: "Comp-off earned", type: "number" },
    ],
    async rows(filters) {
      const attendanceService = require("../attendance/attendance.service");
      const employees = await loadEmployees(filters);
      const out = [];
      const totalDays = dt.daysBetween(filters.fromDate, filters.toDate) + 1;
      for (const e of employees) {
        const s = await attendanceService.summaryFor(e._id, filters.fromDate, filters.toDate);
        const emp = e.employment || {};
        out.push({
          employeeCode: e.employeeCode,
          name: [e.personal.firstName, e.personal.lastName].filter(Boolean).join(" "),
          department: emp.departmentId && emp.departmentId.name,
          designation: emp.designationId && emp.designationId.name,
          location: emp.locationId && emp.locationId.name,
          totalDays,
          present: s.present,
          halfDay: s.halfDay,
          absent: s.absent,
          leave: s.leave,
          weeklyOff: s.weeklyOff,
          holiday: s.holiday,
          late: s.late,
          earlyLeaving: s.earlyLeaving,
          missingPunch: s.missingPunch,
          payableDays: s.payableDays,
          workedHours: s.workedHours,
          overtimeHours: s.overtimeHours,
          compOffEarned: s.compOffEarned,
        });
      }
      return out;
    },
  },

  /**
   * The muster roll: employees down, dates across, one letter per cell. The
   * fields are generated per period (D01…D31), which is why this source
   * declares them through a function rather than a static list.
   */
  attendance_muster: {
    label: "Attendance — muster roll (grid)",
    description: "Employees down the side, days across the top, a status code in each cell.",
    permission: "attendance.view",
    filters: ["fromDate", "toDate", "departmentId", "locationId", "employeeIds"],
    requiresDateRange: true,
    dynamicFields: true,
    fields: [
      { key: "employeeCode", label: "Employee code", type: "text" },
      { key: "name", label: "Name", type: "text" },
      { key: "department", label: "Department", type: "text" },
      { key: "designation", label: "Designation", type: "text" },
      { key: "present", label: "P", type: "number" },
      { key: "absent", label: "A", type: "number" },
      { key: "leave", label: "L", type: "number" },
      { key: "weeklyOff", label: "WO", type: "integer" },
      { key: "holiday", label: "H", type: "integer" },
      { key: "payableDays", label: "Payable", type: "number" },
    ],
    fieldsFor(filters) {
      const days = filters.fromDate && filters.toDate ? dt.eachDate(filters.fromDate, filters.toDate, 62) : [];
      const dayFields = days.map((date) => ({ key: `D${date.slice(8)}`, label: date.slice(8), type: "text", width: 4 }));
      return [...this.fields.slice(0, 4), ...dayFields, ...this.fields.slice(4)];
    },
    async rows(filters) {
      const employees = await loadEmployees(filters);
      const byId = Object.fromEntries(employees.map((e) => [String(e._id), { e, days: {}, counts: { present: 0, absent: 0, leave: 0, weeklyOff: 0, holiday: 0, payableDays: 0 } }]));
      const records = await AttendanceRecord.find({
        employeeId: { $in: employees.map((e) => e._id) },
        date: { $gte: filters.fromDate, $lte: filters.toDate },
      })
        .select("employeeId date status payableDays")
        .lean();

      const CODE = { present: "P", absent: "A", half_day: "½", weekly_off: "WO", holiday: "H", leave: "L", on_duty: "OD", work_from_home: "WFH", comp_off: "CO", pending: "-", not_applicable: "NA" };
      for (const r of records) {
        const entry = byId[String(r.employeeId)];
        if (!entry) continue;
        entry.days[`D${r.date.slice(8)}`] = CODE[r.status] || r.status;
        if (["present", "on_duty", "work_from_home"].includes(r.status)) entry.counts.present += 1;
        else if (r.status === "half_day") entry.counts.present += 0.5;
        else if (r.status === "absent") entry.counts.absent += 1;
        else if (r.status === "leave" || r.status === "comp_off") entry.counts.leave += 1;
        else if (r.status === "weekly_off") entry.counts.weeklyOff += 1;
        else if (r.status === "holiday") entry.counts.holiday += 1;
        entry.counts.payableDays += r.payableDays || 0;
      }

      return Object.values(byId).map(({ e, days, counts }) => ({
        employeeCode: e.employeeCode,
        name: [e.personal.firstName, e.personal.lastName].filter(Boolean).join(" "),
        department: e.employment.departmentId && e.employment.departmentId.name,
        designation: e.employment.designationId && e.employment.designationId.name,
        ...days,
        ...counts,
        payableDays: Math.round(counts.payableDays * 100) / 100,
      }));
    },
  },

  leave_requests: {
    label: "Leave register",
    description: "One row per leave request overlapping the period.",
    permission: "leave.view",
    filters: ["fromDate", "toDate", "departmentId", "leaveTypeId", "status"],
    requiresDateRange: true,
    fields: [
      { key: "employeeCode", label: "Employee code", type: "text" },
      { key: "name", label: "Name", type: "text" },
      { key: "department", label: "Department", type: "text" },
      { key: "leaveType", label: "Leave type", type: "text" },
      { key: "fromDate", label: "From", type: "date" },
      { key: "toDate", label: "To", type: "date" },
      { key: "calendarDays", label: "Calendar days", type: "number" },
      { key: "days", label: "Leave days", type: "number" },
      { key: "status", label: "Status", type: "text" },
      { key: "reason", label: "Reason", type: "text" },
      { key: "appliedOn", label: "Applied on", type: "date" },
      { key: "approver", label: "Decided by", type: "text" },
    ],
    async rows(filters, ctx) {
      const employees = await loadEmployees(filters);
      const byId = Object.fromEntries(employees.map((e) => [String(e._id), e]));
      const query = { employeeId: { $in: employees.map((e) => e._id) }, fromDate: { $lte: filters.toDate }, toDate: { $gte: filters.fromDate } };
      if (filters.status) query.status = filters.status;
      if (filters.leaveTypeId) query.leaveTypeId = filters.leaveTypeId;
      const rows = await LeaveRequest.find(query).populate("leaveTypeId", "name").sort({ fromDate: 1 }).limit(50000).lean();
      return rows.map((r) => {
        const e = byId[String(r.employeeId)] || {};
        const decided = (r.approvals || []).find((a) => a.decision !== "pending");
        return {
          employeeCode: e.employeeCode,
          name: e.personal ? [e.personal.firstName, e.personal.lastName].filter(Boolean).join(" ") : "",
          department: e.employment && e.employment.departmentId && e.employment.departmentId.name,
          leaveType: r.leaveTypeId && r.leaveTypeId.name,
          fromDate: r.fromDate,
          toDate: r.toDate,
          calendarDays: r.calendarDays,
          days: r.leaveDays,
          status: r.status,
          reason: r.reason,
          appliedOn: dt.toDateString(r.createdAt, ctx.timezone),
          approver: decided ? decided.approverName : "",
        };
      });
    },
  },

  leave_balances: {
    label: "Leave balances",
    description: "One row per employee per leave type for a year.",
    permission: "leave.view",
    filters: ["year", "departmentId", "leaveTypeId"],
    fields: [
      { key: "employeeCode", label: "Employee code", type: "text" },
      { key: "name", label: "Name", type: "text" },
      { key: "department", label: "Department", type: "text" },
      { key: "leaveType", label: "Leave type", type: "text" },
      { key: "year", label: "Year", type: "integer" },
      { key: "opening", label: "Opening", type: "number" },
      { key: "allocated", label: "Allocated", type: "number" },
      { key: "carriedForward", label: "Carried forward", type: "number" },
      { key: "credited", label: "Credited", type: "number" },
      { key: "used", label: "Used", type: "number" },
      { key: "pending", label: "Pending", type: "number" },
      { key: "encashed", label: "Encashed", type: "number" },
      { key: "lapsed", label: "Lapsed", type: "number" },
      { key: "adjustment", label: "Adjustment", type: "number" },
      { key: "available", label: "Available", type: "number" },
    ],
    async rows(filters) {
      const employees = await loadEmployees(filters);
      const byId = Object.fromEntries(employees.map((e) => [String(e._id), e]));
      const query = { employeeId: { $in: employees.map((e) => e._id) }, year: Number(filters.year) || new Date().getFullYear() };
      if (filters.leaveTypeId) query.leaveTypeId = filters.leaveTypeId;
      const [balances, types] = await Promise.all([LeaveBalance.find(query).lean(), LeaveType.find({}).select("name").lean()]);
      const typeName = Object.fromEntries(types.map((t) => [String(t._id), t.name]));
      return balances.map((b) => {
        const e = byId[String(b.employeeId)] || {};
        return {
          employeeCode: e.employeeCode,
          name: e.personal ? [e.personal.firstName, e.personal.lastName].filter(Boolean).join(" ") : "",
          department: e.employment && e.employment.departmentId && e.employment.departmentId.name,
          leaveType: typeName[String(b.leaveTypeId)] || "",
          year: b.year,
          opening: b.opening,
          allocated: b.allocated,
          carriedForward: b.carriedForward,
          credited: b.credited,
          used: b.used,
          pending: b.pending,
          encashed: b.encashed,
          lapsed: b.lapsed,
          adjustment: b.adjustment,
          available: Math.round((b.opening + b.allocated + b.carriedForward + b.credited + b.adjustment - b.used - b.pending - b.encashed - b.lapsed) * 100) / 100,
        };
      });
    },
  },

  /**
   * The payroll register: one row per employee in a run, with every salary
   * component as its own column named by its code — BASIC, HRA, PF — so a
   * salary sheet template can pick exactly the columns the bank or the
   * auditor wants, and a formula column can add or compare them.
   */
  payroll_items: {
    label: "Payroll register (by run)",
    description: "One row per employee in a payroll run, every component as a column.",
    permission: "payroll.view",
    sensitivePermission: "employee.view_sensitive",
    filters: ["runId", "departmentId"],
    requiresRun: true,
    dynamicFields: true,
    fields: [
      { key: "employeeCode", label: "Employee code", type: "text" },
      { key: "name", label: "Name", type: "text" },
      { key: "designation", label: "Designation", type: "text" },
      { key: "department", label: "Department", type: "text" },
      { key: "location", label: "Location", type: "text" },
      { key: "joiningDate", label: "Joining date", type: "date" },
      { key: "period", label: "Period", type: "text" },
      { key: "totalDays", label: "Days in period", type: "integer" },
      { key: "workingDays", label: "Working days", type: "integer" },
      { key: "payableDays", label: "Payable days", type: "number" },
      { key: "presentDays", label: "Present days", type: "number" },
      { key: "paidLeaveDays", label: "Paid leave", type: "number" },
      { key: "lopDays", label: "LOP days", type: "number" },
      { key: "overtimeHours", label: "OT hours", type: "number" },
      { key: "gross", label: "Gross", type: "money" },
      { key: "totalDeductions", label: "Total deductions", type: "money" },
      { key: "employerContributions", label: "Employer contributions", type: "money" },
      { key: "net", label: "Net pay", type: "money" },
      { key: "ctc", label: "CTC (period)", type: "money" },
      { key: "bankName", label: "Bank", type: "text", sensitive: true },
      { key: "accountHolderName", label: "Account holder", type: "text", sensitive: true },
      { key: "accountNumber", label: "Account number", type: "text", sensitive: true },
      { key: "ifscCode", label: "IFSC", type: "text", sensitive: true },
      { key: "paymentMode", label: "Payment mode", type: "text", sensitive: true },
      { key: "uan", label: "UAN", type: "text", sensitive: true },
      { key: "pfNumber", label: "PF number", type: "text", sensitive: true },
      { key: "esiNumber", label: "ESI number", type: "text", sensitive: true },
      { key: "pan", label: "PAN", type: "text", sensitive: true },
      { key: "status", label: "Item status", type: "text" },
    ],
    async fieldsFor() {
      const components = await SalaryComponent.find({ isActive: true }).select("code name type").sort({ order: 1 }).lean();
      const componentFields = components.map((c) => ({
        key: c.code,
        label: c.name,
        type: "money",
        group: c.type,
      }));
      const idx = this.fields.findIndex((f) => f.key === "gross");
      return [...this.fields.slice(0, idx), ...componentFields, ...this.fields.slice(idx)];
    },
    async rows(filters, ctx) {
      if (!filters.runId) return [];
      const run = await PayrollRun.findById(filters.runId).lean();
      if (!run) return [];
      const period = await PayrollPeriod.findById(run.periodId).lean();
      const items = await PayrollItem.find({ runId: run._id, ...(filters.status ? { status: filters.status } : {}) })
        .sort({ "employeeSnapshot.employeeCode": 1 })
        .lean();
      const employees = await Employee.find({ _id: { $in: items.map((i) => i.employeeId) }, ...(filters.departmentId ? { "employment.departmentId": filters.departmentId } : {}) })
        .select("bank statutory employment.joiningDate employment.locationId identityDocuments")
        .populate("employment.locationId", "name")
        .lean();
      const byId = Object.fromEntries(employees.map((e) => [String(e._id), e]));

      return items
        .filter((i) => byId[String(i.employeeId)])
        .map((i) => {
          const e = byId[String(i.employeeId)];
          const bank = e.bank || {};
          const stat = e.statutory || {};
          const row = {
            employeeCode: i.employeeSnapshot.employeeCode,
            name: i.employeeSnapshot.name,
            designation: i.employeeSnapshot.designation,
            department: i.employeeSnapshot.department,
            location: (e.employment.locationId && e.employment.locationId.name) || i.employeeSnapshot.location,
            joiningDate: e.employment.joiningDate ? dt.toDateString(e.employment.joiningDate, ctx.timezone) : null,
            period: period ? period.name : "",
            totalDays: i.attendance.totalDays,
            workingDays: i.attendance.workingDays,
            payableDays: i.attendance.payableDays,
            presentDays: i.attendance.presentDays,
            paidLeaveDays: i.attendance.paidLeaveDays,
            lopDays: i.attendance.lossOfPayDays,
            overtimeHours: i.attendance.overtimeHours,
            gross: i.gross,
            totalDeductions: i.totalDeductions,
            employerContributions: i.employerContributions,
            net: i.net,
            ctc: i.ctc,
            bankName: bank.bankName,
            accountHolderName: bank.accountHolderName || i.employeeSnapshot.name,
            accountNumber: bank.accountNumber,
            ifscCode: bank.ifscCode,
            paymentMode: bank.paymentMode,
            uan: stat.uan,
            pfNumber: stat.pfNumber,
            esiNumber: stat.esiNumber,
            pan: stat.taxId || ((e.identityDocuments || []).find((d) => String(d.type).toLowerCase() === "pan") || {}).number || "",
            status: i.status,
          };
          for (const line of i.lines || []) row[line.code] = line.amount;
          for (const adj of i.adjustments || []) {
            row[adj.type === "earning" ? "ADJ_EARNINGS" : "ADJ_DEDUCTIONS"] = (row[adj.type === "earning" ? "ADJ_EARNINGS" : "ADJ_DEDUCTIONS"] || 0) + adj.amount;
          }
          return row;
        });
    },
  },

  salary_register: {
    label: "Salary structure register",
    description: "Current CTC and component amounts for every employee — before attendance.",
    permission: "payroll.view",
    sensitivePermission: "employee.view_sensitive",
    filters: ["departmentId", "locationId", "designationId"],
    dynamicFields: true,
    fields: [
      { key: "employeeCode", label: "Employee code", type: "text" },
      { key: "name", label: "Name", type: "text" },
      { key: "department", label: "Department", type: "text" },
      { key: "designation", label: "Designation", type: "text" },
      { key: "location", label: "Location", type: "text" },
      { key: "joiningDate", label: "Joining date", type: "date" },
      { key: "structure", label: "Salary structure", type: "text" },
      { key: "effectiveFrom", label: "Effective from", type: "date" },
      { key: "ctcAnnual", label: "Annual CTC", type: "money" },
      { key: "ctcMonthly", label: "Monthly CTC", type: "money" },
      { key: "revisionType", label: "Last revision", type: "text" },
    ],
    async fieldsFor() {
      const components = await SalaryComponent.find({ isActive: true }).select("code name type").sort({ order: 1 }).lean();
      return [...this.fields, ...components.map((c) => ({ key: c.code, label: c.name, type: "money", group: c.type }))];
    },
    async rows(filters, ctx) {
      const payrollService = require("../payroll/payroll.service");
      const engine = require("../payroll/payrollEngine");
      const employees = await loadEmployees(filters);
      const today = dt.todayString(ctx.timezone);
      const components = await SalaryComponent.find({ isActive: true }).lean();
      const out = [];

      for (const e of employees) {
        const salary = await payrollService.salaryFor(e._id, today).catch(() => null);
        const emp = e.employment || {};
        const row = {
          employeeCode: e.employeeCode,
          name: [e.personal.firstName, e.personal.lastName].filter(Boolean).join(" "),
          department: emp.departmentId && emp.departmentId.name,
          designation: emp.designationId && emp.designationId.name,
          location: emp.locationId && emp.locationId.name,
          joiningDate: emp.joiningDate ? dt.toDateString(emp.joiningDate, ctx.timezone) : null,
          structure: salary && salary.structureId && salary.structureId.name ? salary.structureId.name : "",
          effectiveFrom: salary ? salary.effectiveFrom : null,
          ctcAnnual: salary ? salary.ctcAnnual : 0,
          ctcMonthly: salary ? salary.ctcMonthly : 0,
          revisionType: salary ? salary.revisionType : "",
        };
        if (salary && typeof engine.computeComponents === "function") {
          try {
            const computed = engine.computeComponents({ salary, components, structure: salary.structureId });
            for (const line of computed.lines || []) row[line.code] = line.fullAmount ?? line.amount;
          } catch {
            /* a structure with a broken formula shows CTC only */
          }
        } else if (salary && salary.componentAmounts) {
          const amounts = salary.componentAmounts instanceof Map ? Object.fromEntries(salary.componentAmounts) : salary.componentAmounts;
          Object.assign(row, amounts);
        }
        out.push(row);
      }
      return out;
    },
  },

  payslips: {
    label: "Published payslips",
    description: "One row per published payslip in a period range.",
    permission: "payroll.view",
    filters: ["fromDate", "toDate", "departmentId"],
    fields: [
      { key: "payslipNumber", label: "Payslip number", type: "text" },
      { key: "employeeCode", label: "Employee code", type: "text" },
      { key: "name", label: "Name", type: "text" },
      { key: "period", label: "Period", type: "text" },
      { key: "gross", label: "Gross", type: "money" },
      { key: "totalDeductions", label: "Deductions", type: "money" },
      { key: "net", label: "Net pay", type: "money" },
      { key: "publishedAt", label: "Published on", type: "date" },
      { key: "viewedAt", label: "Viewed by employee", type: "date" },
    ],
    async rows(filters, ctx) {
      const employees = await loadEmployees({ ...filters, includeInactive: true });
      const byId = Object.fromEntries(employees.map((e) => [String(e._id), e]));
      const query = { employeeId: { $in: employees.map((e) => e._id) } };
      if (filters.fromDate) query.publishedAt = { $gte: new Date(`${filters.fromDate}T00:00:00Z`) };
      if (filters.toDate) query.publishedAt = { ...(query.publishedAt || {}), $lte: new Date(`${filters.toDate}T23:59:59Z`) };
      const slips = await Payslip.find(query).sort({ publishedAt: -1 }).limit(50000).lean();
      return slips.map((s) => {
        const e = byId[String(s.employeeId)] || {};
        return {
          payslipNumber: s.payslipNumber,
          employeeCode: e.employeeCode,
          name: e.personal ? [e.personal.firstName, e.personal.lastName].filter(Boolean).join(" ") : "",
          period: s.periodLabel,
          gross: s.gross,
          totalDeductions: s.totalDeductions,
          net: s.net,
          publishedAt: dt.toDateString(s.publishedAt, ctx.timezone),
          viewedAt: s.viewedAt ? dt.toDateString(s.viewedAt, ctx.timezone) : null,
        };
      });
    },
  },

  joiners_leavers: {
    label: "Joiners and leavers",
    description: "Everyone who joined or left in the period.",
    permission: "employee.view",
    filters: ["fromDate", "toDate", "departmentId"],
    requiresDateRange: true,
    fields: [
      { key: "kind", label: "Joined / Left", type: "text" },
      { key: "date", label: "Date", type: "date" },
      { key: "employeeCode", label: "Employee code", type: "text" },
      { key: "name", label: "Name", type: "text" },
      { key: "department", label: "Department", type: "text" },
      { key: "designation", label: "Designation", type: "text" },
      { key: "location", label: "Location", type: "text" },
      { key: "employmentType", label: "Employment type", type: "text" },
      { key: "exitType", label: "Exit type", type: "text" },
      { key: "tenureMonths", label: "Tenure (months)", type: "integer" },
    ],
    async rows(filters, ctx) {
      const from = new Date(`${filters.fromDate}T00:00:00Z`);
      const to = new Date(`${filters.toDate}T23:59:59Z`);
      const base = filters.departmentId ? { "employment.departmentId": filters.departmentId } : {};
      const populate = [
        { path: "employment.departmentId", select: "name" },
        { path: "employment.designationId", select: "name" },
        { path: "employment.locationId", select: "name" },
      ];
      const [joiners, leavers] = await Promise.all([
        Employee.find({ ...base, "employment.joiningDate": { $gte: from, $lte: to } }).populate(populate).lean(),
        Employee.find({ ...base, "exit.lastWorkingDay": { $gte: from, $lte: to } }).populate(populate).lean(),
      ]);
      const shape = (e, kind, date) => ({
        kind,
        date: dt.toDateString(date, ctx.timezone),
        employeeCode: e.employeeCode,
        name: [e.personal.firstName, e.personal.lastName].filter(Boolean).join(" "),
        department: e.employment.departmentId && e.employment.departmentId.name,
        designation: e.employment.designationId && e.employment.designationId.name,
        location: e.employment.locationId && e.employment.locationId.name,
        employmentType: String(e.employment.employmentType || "").replace(/_/g, " "),
        exitType: kind === "Left" ? e.exit && e.exit.exitType : "",
        tenureMonths: e.employment.joiningDate ? dt.monthsSince(dt.toDateString(e.employment.joiningDate, ctx.timezone), dt.toDateString(date, ctx.timezone)) : null,
      });
      return [
        ...joiners.map((e) => shape(e, "Joined", e.employment.joiningDate)),
        ...leavers.map((e) => shape(e, "Left", e.exit.lastWorkingDay)),
      ].sort((a, b) => a.date.localeCompare(b.date));
    },
  },
};

/** The catalog for the designer: label, filters, and the fields it offers. */
async function describeSources() {
  const out = [];
  for (const [key, source] of Object.entries(SOURCES)) {
    out.push({
      key,
      label: source.label,
      description: source.description,
      permission: source.permission,
      sensitivePermission: source.sensitivePermission || null,
      filters: source.filters,
      requiresDateRange: Boolean(source.requiresDateRange),
      requiresRun: Boolean(source.requiresRun),
      dynamicFields: Boolean(source.dynamicFields),
      fields: source.fields,
    });
  }
  return out;
}

/** Fields for one source, including run-dependent ones (salary components). */
async function fieldsFor(sourceKey, filters = {}) {
  const source = SOURCES[sourceKey];
  if (!source) return [];
  if (typeof source.fieldsFor === "function") return source.fieldsFor(filters);
  return source.fields;
}

module.exports = { SOURCES, describeSources, fieldsFor, employeeFields, loadEmployees };
