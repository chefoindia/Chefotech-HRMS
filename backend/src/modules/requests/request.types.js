"use strict";

const { z } = require("zod");
const { objectId, dateString } = require("../../core/validation/common");
const dt = require("../../shared/datetime");

/**
 * The request types: what each asks for, how it is summarised, who decides
 * it by default, and what approval actually does.
 *
 * `apply(request, employee, req)` runs when a request is approved and
 * returns the effect to record. It must be idempotent enough that a second
 * call does no harm — approvals are decided once, but jobs retry.
 */

const wfhSchema = z
  .object({
    fromDate: dateString(),
    toDate: dateString(),
  })
  .refine((v) => v.toDate >= v.fromDate, { message: "The end date must not be before the start date", path: ["toDate"] })
  .refine((v) => dt.daysBetween(v.fromDate, v.toDate) <= 31, { message: "Ask for at most a month at a time", path: ["toDate"] });

const TYPES = {
  wfh: {
    label: "Work from home",
    description: "Ask to work from home on specific days. Approved days are marked as work-from-home in attendance.",
    schema: wfhSchema,
    approver: "manager",
    summary: (p) => (p.fromDate === p.toDate ? `Work from home on ${p.fromDate}` : `Work from home ${p.fromDate} to ${p.toDate}`),
    async apply(request, employee, req) {
      const attendance = require("../attendance/attendance.service");
      const dates = dt.eachDate(request.payload.fromDate, request.payload.toDate, 31);
      const marked = [];
      for (const date of dates) {
        try {
          await attendance.overrideDay(employee._id, date, { status: "work_from_home", reason: `WFH request ${request._id}`, payableDays: 1 }, req);
          marked.push(date);
        } catch (err) {
          // A locked or non-working day is left as it is; the rest still apply.
          if (!/locked|weekly|holiday/i.test(err.message)) throw err;
        }
      }
      return { markedDates: marked };
    },
  },

  comp_off: {
    label: "Compensatory off",
    description: "Claim a day off for a weekly off or holiday you worked.",
    schema: z.object({
      workedOn: dateString(),
      days: z.number().min(0.5).max(2).default(1),
    }),
    approver: "manager",
    summary: (p) => `${p.days || 1} day comp-off for working on ${p.workedOn}`,
    async apply(request, employee, req) {
      const leave = require("../leave/leave.service");
      const balance = await leave.creditCompOff(employee._id, request.payload.days || 1, { date: request.payload.workedOn, note: `Comp-off request ${request._id}` }, req);
      if (!balance) throw new Error("No comp-off leave type is configured. Create a leave type marked as comp-off first.");
      return { credited: request.payload.days || 1 };
    },
  },

  encashment: {
    label: "Leave encashment",
    description: "Convert unused leave into pay with the next salary.",
    schema: z.object({
      leaveTypeId: objectId(),
      days: z.number().min(0.5).max(60),
    }),
    approver: "hr",
    summary: (p) => `Encash ${p.days} day(s) of leave`,
    async apply(request, employee, req) {
      const leave = require("../leave/leave.service");
      const payroll = require("../payroll/payroll.service");
      const inputs = require("../payroll/inputs.service");
      const { LeaveType } = require("../leave/leave.model");
      const settings = require("../../core/settings/settings.service");

      const leaveType = await LeaveType.findById(request.payload.leaveTypeId).lean();
      if (!leaveType) throw new Error("That leave type no longer exists.");

      // Per-day rate: basic (or gross) monthly / 30, as the organization prefers.
      const salary = await payroll.salaryFor(employee._id, dt.todayString());
      if (!salary) throw new Error("No salary is assigned, so the encashment amount cannot be computed.");
      const basis = await settings.get("leave.encashment_basis").catch(() => "gross");
      const monthly = salary.ctcMonthly || 0;
      const amounts = salary.componentAmounts instanceof Map ? Object.fromEntries(salary.componentAmounts) : salary.componentAmounts || {};
      const perDay = (basis === "basic" && amounts.BASIC ? amounts.BASIC : monthly) / 30;
      const amount = Math.round(perDay * request.payload.days * 100) / 100;

      await leave.adjustEmployeeBalance(employee._id, { leaveTypeId: leaveType._id, days: -request.payload.days, note: `Encashed ${request.payload.days} day(s)` }, req);
      const input = await inputs.add(
        { employeeId: employee._id, type: "earning", label: `Leave encashment (${leaveType.name}, ${request.payload.days} days)`, amount, reason: `Request ${request._id}`, source: { type: "encashment", id: request._id } },
        req
      );
      return { days: request.payload.days, amount, payrollInputId: String(input._id) };
    },
  },

  shift_swap: {
    label: "Shift change",
    description: "Ask to move to a different shift for a period, or swap with a colleague.",
    schema: z.object({
      shiftId: objectId(),
      fromDate: dateString(),
      toDate: dateString(),
      swapWithEmployeeId: objectId().optional(),
    }),
    approver: "manager",
    summary: (p) => (p.fromDate === p.toDate ? `Shift change on ${p.fromDate}` : `Shift change ${p.fromDate} to ${p.toDate}`),
    async apply(request, employee, req) {
      const shifts = require("../shifts/shift.service");
      const Employee = require("../employees/employee.model");
      const effect = { assigned: [String(employee._id)] };
      await shifts.assign({ employeeIds: [employee._id], shiftId: request.payload.shiftId, fromDate: request.payload.fromDate, toDate: request.payload.toDate, reason: `Shift request ${request._id}` }, req);
      if (request.payload.swapWithEmployeeId) {
        // The colleague takes this employee's current shift for the same days.
        const mine = await Employee.findById(employee._id).select("employment.shiftId").lean();
        if (mine && mine.employment && mine.employment.shiftId) {
          await shifts.assign({ employeeIds: [request.payload.swapWithEmployeeId], shiftId: mine.employment.shiftId, fromDate: request.payload.fromDate, toDate: request.payload.toDate, reason: `Shift swap ${request._id}` }, req);
          effect.assigned.push(String(request.payload.swapWithEmployeeId));
        }
      }
      return effect;
    },
  },

  letter: {
    label: "Letter or certificate",
    description: "Ask HR for a bonafide letter, address proof, salary certificate or similar.",
    schema: z.object({
      templateCode: z.string().trim().min(1).max(40),
      purpose: z.string().max(300).optional(),
    }),
    approver: "hr",
    summary: (p) => `${String(p.templateCode).replace(/_/g, " ").toLowerCase()} letter`,
    async apply(request, employee, req) {
      const documents = require("../documents/document.service");
      const { DocumentTemplate } = require("../documents/document.model");
      const template = await DocumentTemplate.findOne({ code: String(request.payload.templateCode).toUpperCase(), isActive: true }).lean();
      if (!template) throw new Error(`No active template with code ${request.payload.templateCode}.`);
      const { document } = await documents.generateAndStore(String(template._id), { employeeId: employee._id, visibleToEmployee: true }, req);
      return { documentId: String(document._id), documentName: document.name };
    },
  },

  profile_change: {
    label: "Change to my details",
    description: "Ask HR to update a bank account, address or other detail that you cannot change yourself.",
    schema: z.object({
      section: z.enum(["personal", "bank", "statutory"]),
      changes: z.record(z.any()),
    }),
    approver: "hr",
    summary: (p) => `Update ${p.section} details (${Object.keys(p.changes || {}).join(", ")})`,
    async apply(request, employee, req) {
      const employees = require("../employees/employee.service");
      const patch = { [request.payload.section]: request.payload.changes };
      await employees.update(String(employee._id), patch, req);
      return { applied: Object.keys(request.payload.changes || {}) };
    },
  },

  advance: {
    label: "Salary advance",
    description: "Ask for part of next month's salary early, recovered from that payslip.",
    schema: z.object({
      amount: z.number().positive().max(10_000_000),
      recoverInPeriod: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    }),
    approver: "hr",
    summary: (p) => `Salary advance of ${p.amount}`,
    async apply(request, employee, req) {
      const inputs = require("../payroll/inputs.service");
      const input = await inputs.add(
        { employeeId: employee._id, type: "deduction", label: "Recovery of salary advance", amount: request.payload.amount, reason: `Advance request ${request._id}`, periodKey: request.payload.recoverInPeriod || null, source: { type: "advance", id: request._id } },
        req
      );
      return { amount: request.payload.amount, recoveryInputId: String(input._id) };
    },
  },

  other: {
    label: "Something else",
    description: "Anything not covered above. HR reads it and replies.",
    schema: z.object({ subject: z.string().trim().min(1).max(120) }),
    approver: "hr",
    summary: (p) => p.subject,
    async apply() {
      return { noted: true };
    },
  },
};

function describe() {
  return Object.entries(TYPES).map(([key, t]) => ({ key, label: t.label, description: t.description, approver: t.approver }));
}

module.exports = { TYPES, describe };
