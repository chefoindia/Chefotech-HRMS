"use strict";

const {
  SalaryComponent,
  SalaryStructure,
  EmployeeSalary,
  PayrollPeriod,
  PayrollRun,
  PayrollItem,
  Payslip,
} = require("./payroll.model");
const engine = require("./payrollEngine");
const Employee = require("../employees/employee.model");
const Organization = require("../organizations/organization.model");
const attendanceService = require("../attendance/attendance.service");
const { AttendanceRecord } = require("../attendance/attendance.model");
const { LeaveDay } = require("../leave/leave.model");
const settingsService = require("../../core/settings/settings.service");
const notifications = require("../notifications/notification.service");
const employeeService = require("../employees/employee.service");
const { AppError } = require("../../core/errors/AppError");
const { parseListQuery } = require("../../core/http/queryOptions");
const audit = require("../../core/audit/audit.service");
const tenant = require("../../core/tenancy/tenantContext");
const { logger } = require("../../config/logger");
const dt = require("../../shared/datetime");

/**
 * Payroll orchestration.
 *
 * Guarantees this file is responsible for:
 *   - a period can have exactly one regular run that reaches "processed";
 *   - a locked run cannot be modified, only superseded by a supplementary run;
 *   - attendance is read from AttendanceRecord, never recomputed here, so
 *     payroll and the attendance screen can never disagree;
 *   - every calculated item carries the breakdown that produced it.
 */

// ── Periods ─────────────────────────────────────────────────────────────────

async function ensurePeriod(year, month) {
  let period = await PayrollPeriod.findOne({ year, month });
  if (period) return period;

  const settings = await settingsService.getMany([
    "payroll.cycle_start_day",
    "payroll.pay_day",
  ]);

  const cycleStartDay = settings["payroll.cycle_start_day"] || 1;
  const bounds = dt.monthBounds(year, month);

  let startDate = bounds.start;
  let endDate = bounds.end;

  // A 26th-to-25th cycle starts in the previous month.
  if (cycleStartDay > 1) {
    const previous = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
    startDate = `${previous.year}-${String(previous.month).padStart(2, "0")}-${String(cycleStartDay).padStart(2, "0")}`;
    endDate = dt.addDays(
      `${year}-${String(month).padStart(2, "0")}-${String(cycleStartDay).padStart(2, "0")}`,
      -1
    );
  }

  const payDay = Math.min(settings["payroll.pay_day"] || 1, 28);
  const payMonth = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  const payDate = `${payMonth.year}-${String(payMonth.month).padStart(2, "0")}-${String(payDay).padStart(2, "0")}`;

  period = await PayrollPeriod.create({
    name: `${new Date(year, month - 1, 1).toLocaleString("en", { month: "long" })} ${year}`,
    year,
    month,
    startDate,
    endDate,
    payDate,
    attendanceFrom: startDate,
    attendanceTo: endDate,
    status: "open",
    totalWorkingDays: dt.daysBetween(startDate, endDate),
  });

  return period;
}

async function listPeriods(query = {}) {
  const filter = {};
  if (query.year) filter.year = Number(query.year);
  return PayrollPeriod.find(filter).sort({ year: -1, month: -1 }).limit(48).lean();
}

// ── Salary assignment ───────────────────────────────────────────────────────

/** The salary in force for an employee on a given date. */
async function salaryFor(employeeId, dateString) {
  return EmployeeSalary.findOne({
    employeeId,
    effectiveFrom: { $lte: dateString },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gte: dateString } }],
    isActive: true,
  })
    .sort({ effectiveFrom: -1 })
    .lean();
}

/**
 * Assign or revise salary.
 * A revision closes the previous record rather than overwriting it, so past
 * payslips stay reproducible.
 */
async function assignSalary(employeeId, data, req) {
  const employee = await Employee.findById(employeeId).lean();
  if (!employee) throw new AppError("EMPLOYEE_NOT_FOUND");

  const structure = await SalaryStructure.findById(data.structureId).lean();
  if (!structure) throw AppError.badRequest("That salary structure does not exist.");

  const existing = await EmployeeSalary.findOne({
    employeeId,
    isActive: true,
    effectiveTo: null,
  }).sort({ effectiveFrom: -1 });

  if (existing) {
    if (data.effectiveFrom <= existing.effectiveFrom) {
      throw AppError.badRequest(
        `The new salary must start after the current one, which began on ${existing.effectiveFrom}.`
      );
    }
    existing.effectiveTo = dt.addDays(data.effectiveFrom, -1);
    await existing.save();
  }

  const salary = await EmployeeSalary.create({
    employeeId,
    structureId: data.structureId,
    effectiveFrom: data.effectiveFrom,
    effectiveTo: null,
    ctcAnnual: data.ctcAnnual || 0,
    ctcMonthly: data.ctcMonthly || Math.round((data.ctcAnnual || 0) / 12),
    componentAmounts: data.componentAmounts || {},
    paymentMode: data.paymentMode || "bank_transfer",
    revisionReason: data.revisionReason || "",
    revisionType: existing ? data.revisionType || "increment" : "initial",
    createdBy: tenant.getUserId(),
  });

  await SalaryStructure.updateOne({ _id: structure._id }, { $inc: { employeeCount: 1 } });

  await audit.record(
    {
      action: existing ? "payroll.salary_revised" : "payroll.salary_assigned",
      entityType: "EmployeeSalary",
      entityId: salary._id,
      entityLabel: `${employee.employeeCode} — ${employee.fullName}`,
      before: existing ? { ctcAnnual: existing.ctcAnnual, effectiveTo: existing.effectiveTo } : null,
      after: { ctcAnnual: salary.ctcAnnual, effectiveFrom: salary.effectiveFrom, structure: structure.name },
      // Salary changes are the single most sensitive edit in an HRMS.
      severity: "critical",
      description: data.revisionReason || "",
    },
    req
  );

  return salary;
}

async function salaryHistory(employeeId, auth) {
  await employeeService.assertCanView(auth, employeeId);
  return EmployeeSalary.find({ employeeId })
    .populate("structureId", "name code")
    .sort({ effectiveFrom: -1 })
    .lean();
}

// ── Attendance input ────────────────────────────────────────────────────────

/**
 * Turn attendance records into the numbers payroll needs.
 * Read-only: payroll never recomputes attendance, it consumes it.
 */
async function attendanceInputFor(employeeId, fromDate, toDate) {
  const [records, leaveDays] = await Promise.all([
    AttendanceRecord.find({ employeeId, date: { $gte: fromDate, $lte: toDate } }).lean(),
    LeaveDay.find({
      employeeId,
      date: { $gte: fromDate, $lte: toDate },
      status: "approved",
      deductedDays: { $gt: 0 },
    })
      .populate("leaveTypeId", "isPaid")
      .lean(),
  ]);

  const summary = {
    totalDays: dt.daysBetween(fromDate, toDate),
    workingDays: 0,
    payableDays: 0,
    presentDays: 0,
    paidLeaveDays: 0,
    unpaidLeaveDays: 0,
    absentDays: 0,
    holidayDays: 0,
    weeklyOffDays: 0,
    overtimeHours: 0,
    recordedDays: records.length,
  };

  for (const record of records) {
    summary.payableDays += record.payableDays || 0;

    if (record.status === "present") summary.presentDays += 1;
    else if (record.status === "half_day") summary.presentDays += 0.5;
    else if (record.status === "absent") summary.absentDays += 1;
    else if (record.status === "holiday") summary.holidayDays += 1;
    else if (record.status === "weekly_off") summary.weeklyOffDays += 1;

    if (!["holiday", "weekly_off", "not_applicable"].includes(record.status)) {
      summary.workingDays += 1;
    }
    if (record.overtimeStatus === "approved") {
      summary.overtimeHours += (record.overtimeMinutes || 0) / 60;
    }
  }

  for (const day of leaveDays) {
    const isPaid = day.leaveTypeId ? day.leaveTypeId.isPaid !== false : true;
    if (isPaid) summary.paidLeaveDays += day.deductedDays;
    else summary.unpaidLeaveDays += day.deductedDays;
  }

  summary.payableDays = Math.round(summary.payableDays * 100) / 100;
  summary.overtimeHours = Math.round(summary.overtimeHours * 100) / 100;

  // No attendance at all for the period usually means the employee is exempt
  // or attendance was never processed. Paying them zero silently would be the
  // worst possible default, so treat the period as fully payable and say so.
  if (!records.length) {
    summary.payableDays = summary.totalDays;
    summary.noAttendanceData = true;
  }

  return summary;
}

// ── Runs ────────────────────────────────────────────────────────────────────

async function createRun({ year, month, type = "regular", scope = {}, notes }, req) {
  const period = await ensurePeriod(year, month);

  if (["locked", "paid"].includes(period.status)) {
    throw new AppError("PAYROLL_LOCKED", {
      message: `${period.name} is locked. Create a supplementary run instead.`,
    });
  }

  if (type === "regular") {
    const existing = await PayrollRun.findOne({
      periodId: period._id,
      type: "regular",
      status: { $nin: ["cancelled", "failed"] },
    }).lean();
    if (existing) {
      throw new AppError("PAYROLL_ALREADY_RUN", {
        message: `A regular payroll run already exists for ${period.name}.`,
        details: { runId: String(existing._id), status: existing.status },
      });
    }
  }

  const runCount = await PayrollRun.countDocuments({ periodId: period._id });

  const run = await PayrollRun.create({
    periodId: period._id,
    runNumber: runCount + 1,
    type,
    status: "draft",
    scope,
    notes: notes || "",
    createdBy: tenant.getUserId(),
  });

  await audit.record(
    {
      action: "payroll.run_created",
      entityType: "PayrollRun",
      entityId: run._id,
      entityLabel: `${period.name} — run ${run.runNumber}`,
      after: { type, scope },
      severity: "notice",
    },
    req
  );

  return run;
}

/**
 * Calculate every employee in scope.
 * Idempotent: re-running replaces the items for that run.
 */
async function processRun(runId, req) {
  const run = await PayrollRun.findById(runId);
  if (!run) throw AppError.notFound("Payroll run");

  if (["locked", "paid"].includes(run.status)) {
    throw new AppError("PAYROLL_LOCKED");
  }

  const period = await PayrollPeriod.findById(run.periodId).lean();
  const settings = await settingsService.all();

  run.status = "processing";
  run.exceptions = [];
  await run.save();

  const filter = {
    status: { $in: ["active", "on_leave", "notice_period", "suspended"] },
  };
  if (run.scope.employeeIds && run.scope.employeeIds.length) {
    filter._id = { $in: run.scope.employeeIds };
  }
  if (run.scope.departmentIds && run.scope.departmentIds.length) {
    filter["employment.departmentId"] = { $in: run.scope.departmentIds };
  }
  if (run.scope.locationIds && run.scope.locationIds.length) {
    filter["employment.locationId"] = { $in: run.scope.locationIds };
  }

  const employees = await Employee.find(filter)
    .populate([
      { path: "employment.departmentId", select: "name" },
      { path: "employment.designationId", select: "name" },
      { path: "employment.locationId", select: "name" },
    ])
    .lean();

  // Structures and components are loaded once for the whole run.
  const [structures, allComponents] = await Promise.all([
    SalaryStructure.find({ isActive: true }).lean(),
    SalaryComponent.find({ isActive: true }).sort({ order: 1 }).lean(),
  ]);
  const structureById = Object.fromEntries(structures.map((s) => [String(s._id), s]));
  const componentById = Object.fromEntries(allComponents.map((c) => [String(c._id), c]));

  // Wipe previous items so a re-run cannot leave stale rows behind.
  await PayrollItem.deleteMany({ runId: run._id });

  const totals = {
    employeeCount: 0,
    grossTotal: 0,
    deductionTotal: 0,
    netTotal: 0,
    employerContributionTotal: 0,
    ctcTotal: 0,
  };
  const errors = [];

  for (const employee of employees) {
    try {
      const salary = await salaryFor(employee._id, period.endDate);
      if (!salary) {
        errors.push({
          employeeId: employee._id,
          employeeCode: employee.employeeCode,
          message: "No salary has been assigned",
        });
        continue;
      }

      const structure = structureById[String(salary.structureId)];
      if (!structure) {
        errors.push({
          employeeId: employee._id,
          employeeCode: employee.employeeCode,
          message: "The assigned salary structure is missing or inactive",
        });
        continue;
      }

      const components = (structure.components || [])
        .map((entry) => {
          const component = componentById[String(entry.componentId)];
          return component ? engine.resolveComponent(component, entry) : null;
        })
        .filter(Boolean)
        .sort((a, b) => a.order - b.order);

      const attendance = await attendanceInputFor(
        employee._id,
        period.attendanceFrom,
        period.attendanceTo
      );

      const calculated = engine.calculate({
        employee,
        salary,
        components,
        attendance,
        settings,
        adjustments: [],
      });

      if (attendance.noAttendanceData) {
        calculated.breakdown.unshift({
          rule: "no_attendance",
          detail:
            "No attendance records exist for this period; the full period was treated as payable.",
          effect: "review",
        });
      }

      const item = await PayrollItem.create({
        runId: run._id,
        periodId: period._id,
        employeeId: employee._id,
        employeeSnapshot: {
          employeeCode: employee.employeeCode,
          name: [employee.personal.firstName, employee.personal.lastName].filter(Boolean).join(" "),
          designation: employee.employment.designationId && employee.employment.designationId.name,
          department: employee.employment.departmentId && employee.employment.departmentId.name,
          location: employee.employment.locationId && employee.employment.locationId.name,
          joiningDate: employee.employment.joiningDate,
          bankAccountLast4: (employee.bank && employee.bank.accountNumber || "").slice(-4),
          paymentMode: salary.paymentMode,
        },
        salaryId: salary._id,
        structureId: structure._id,
        attendance: calculated.attendance,
        lines: calculated.lines,
        gross: calculated.gross,
        totalDeductions: calculated.totalDeductions,
        employerContributions: calculated.employerContributions,
        net: calculated.net,
        ctc: calculated.ctc,
        breakdown: calculated.breakdown,
        status: calculated.errors.length ? "error" : "calculated",
        error: calculated.errors.length ? calculated.errors.map((e) => `${e.component}: ${e.message}`).join("; ") : null,
      });

      totals.employeeCount += 1;
      totals.grossTotal += item.gross;
      totals.deductionTotal += item.totalDeductions;
      totals.netTotal += item.net;
      totals.employerContributionTotal += item.employerContributions;
      totals.ctcTotal += item.ctc;
    } catch (err) {
      logger.error({ err, employeeId: String(employee._id) }, "Payroll calculation failed");
      errors.push({
        employeeId: employee._id,
        employeeCode: employee.employeeCode,
        message: err.message,
      });
    }
  }

  run.totals = {
    employeeCount: totals.employeeCount,
    grossTotal: round2(totals.grossTotal),
    deductionTotal: round2(totals.deductionTotal),
    netTotal: round2(totals.netTotal),
    employerContributionTotal: round2(totals.employerContributionTotal),
    ctcTotal: round2(totals.ctcTotal),
  };
  run.exceptions = errors;
  run.status = totals.employeeCount === 0 && errors.length ? "failed" : "processed";
  run.processedAt = new Date();
  run.processedBy = tenant.getUserId();
  await run.save();

  await PayrollPeriod.updateOne({ _id: period._id }, { $set: { status: "processed" } });

  await audit.record(
    {
      action: "payroll.run_processed",
      entityType: "PayrollRun",
      entityId: run._id,
      entityLabel: `${period.name} — run ${run.runNumber}`,
      after: { ...run.totals, errors: errors.length },
      severity: "warning",
    },
    req
  );

  logger.info(
    { run: String(run._id), employees: totals.employeeCount, errors: errors.length },
    "Payroll run processed"
  );

  return run;
}

/** Add a one-off earning or deduction to one employee's payroll. */
async function addAdjustment(itemId, adjustment, req) {
  const item = await PayrollItem.findById(itemId);
  if (!item) throw AppError.notFound("Payroll item");

  const run = await PayrollRun.findById(item.runId).lean();
  if (["locked", "paid"].includes(run.status)) throw new AppError("PAYROLL_LOCKED");

  item.adjustments.push({ ...adjustment, addedBy: tenant.getUserId(), addedAt: new Date() });

  const earnings = item.adjustments.filter((a) => a.type === "earning").reduce((s, a) => s + a.amount, 0);
  const deductions = item.adjustments.filter((a) => a.type === "deduction").reduce((s, a) => s + a.amount, 0);

  const baseGross = item.lines.filter((l) => l.type === "earning").reduce((s, l) => s + l.amount, 0);
  const baseDeductions = item.lines.filter((l) => l.type === "deduction").reduce((s, l) => s + l.amount, 0);

  item.gross = round2(baseGross + earnings);
  item.totalDeductions = round2(baseDeductions + deductions);
  item.net = round2(item.gross - item.totalDeductions);
  item.breakdown.push({
    rule: "adjustment",
    detail: `${adjustment.label}: ${adjustment.reason || ""}`,
    effect: `${adjustment.type === "earning" ? "+" : "−"}${adjustment.amount}`,
  });

  await item.save();
  await recalculateRunTotals(item.runId);

  await audit.record(
    {
      action: "payroll.adjustment_added",
      entityType: "PayrollItem",
      entityId: item._id,
      entityLabel: item.employeeSnapshot.employeeCode,
      after: adjustment,
      severity: "warning",
    },
    req
  );

  return item;
}

async function recalculateRunTotals(runId) {
  const [row] = await PayrollItem.aggregate([
    { $match: { runId: new (require("mongoose").Types.ObjectId)(String(runId)), status: { $ne: "excluded" } } },
    {
      $group: {
        _id: null,
        employeeCount: { $sum: 1 },
        grossTotal: { $sum: "$gross" },
        deductionTotal: { $sum: "$totalDeductions" },
        netTotal: { $sum: "$net" },
        employerContributionTotal: { $sum: "$employerContributions" },
        ctcTotal: { $sum: "$ctc" },
      },
    },
  ]);

  await PayrollRun.updateOne(
    { _id: runId },
    {
      $set: {
        totals: row
          ? {
              employeeCount: row.employeeCount,
              grossTotal: round2(row.grossTotal),
              deductionTotal: round2(row.deductionTotal),
              netTotal: round2(row.netTotal),
              employerContributionTotal: round2(row.employerContributionTotal),
              ctcTotal: round2(row.ctcTotal),
            }
          : { employeeCount: 0, grossTotal: 0, deductionTotal: 0, netTotal: 0, employerContributionTotal: 0, ctcTotal: 0 },
      },
    }
  );
}

async function approveRun(runId, req) {
  const run = await PayrollRun.findById(runId);
  if (!run) throw AppError.notFound("Payroll run");
  if (run.status !== "processed") {
    throw new AppError("WORKFLOW_INVALID_STATE", {
      message: `Only a processed run can be approved. This one is ${run.status}.`,
    });
  }
  if (run.exceptions.length) {
    throw AppError.conflict(
      `${run.exceptions.length} employee(s) could not be calculated. Resolve those before approving.`,
      { errors: run.exceptions.slice(0, 10) }
    );
  }

  run.status = "approved";
  run.approvedAt = new Date();
  run.approvedBy = tenant.getUserId();
  await run.save();

  await audit.record(
    {
      action: "payroll.run_approved",
      entityType: "PayrollRun",
      entityId: run._id,
      entityLabel: `Run ${run.runNumber}`,
      after: run.totals,
      severity: "critical",
    },
    req
  );

  return run;
}

/**
 * Lock a run. After this the numbers are frozen: corrections must be made
 * through a supplementary run so the trail stays intact.
 */
async function lockRun(runId, req) {
  const run = await PayrollRun.findById(runId);
  if (!run) throw AppError.notFound("Payroll run");
  if (run.status !== "approved") {
    throw new AppError("WORKFLOW_INVALID_STATE", {
      message: "A run must be approved before it can be locked.",
    });
  }

  run.status = "locked";
  run.lockedAt = new Date();
  run.lockedBy = tenant.getUserId();
  await run.save();

  await PayrollPeriod.updateOne(
    { _id: run.periodId },
    { $set: { status: "locked", lockedAt: new Date(), lockedBy: tenant.getUserId() } }
  );

  // Attendance for the period is locked too: payroll now depends on it.
  const period = await PayrollPeriod.findById(run.periodId).lean();
  await attendanceService
    .lockPeriod(
      {
        fromDate: period.attendanceFrom,
        toDate: period.attendanceTo,
        reason: `Payroll locked for ${period.name}`,
      },
      req
    )
    .catch((err) => logger.warn({ err }, "Attendance period was already locked"));

  await audit.record(
    {
      action: "payroll.run_locked",
      entityType: "PayrollRun",
      entityId: run._id,
      entityLabel: `Run ${run.runNumber}`,
      after: run.totals,
      severity: "critical",
      description: "Payroll figures frozen; attendance for the period locked",
    },
    req
  );

  return run;
}

/** Publish payslips to employees. */
async function publishPayslips(runId, req) {
  const run = await PayrollRun.findById(runId);
  if (!run) throw AppError.notFound("Payroll run");

  const requiresApproval = await settingsService.get("payroll.payslip_publish_requires_approval");
  if (requiresApproval && !["approved", "locked", "paid"].includes(run.status)) {
    throw new AppError("WORKFLOW_INVALID_STATE", {
      message: "This payroll run has to be approved before payslips can be published.",
    });
  }

  const period = await PayrollPeriod.findById(run.periodId).lean();
  const items = await PayrollItem.find({ runId: run._id, status: "calculated" }).lean();
  const organization = await tenant.runAsSystem(
    () => Organization.findById(tenant.requireOrganizationId()).lean(),
    "payroll.publish"
  );

  let published = 0;
  for (const item of items) {
    try {
      const payslipNumber = `PS-${period.year}${String(period.month).padStart(2, "0")}-${item.employeeSnapshot.employeeCode}`;

      await Payslip.findOneAndUpdate(
        { employeeId: item.employeeId, periodId: period._id },
        {
          $set: {
            itemId: item._id,
            runId: run._id,
            periodId: period._id,
            employeeId: item.employeeId,
            payslipNumber,
            periodLabel: period.name,
            gross: item.gross,
            totalDeductions: item.totalDeductions,
            net: item.net,
            // The snapshot is what makes the payslip immutable: recalculating
            // the run later cannot change a payslip already issued.
            snapshot: item,
            publishedAt: new Date(),
            publishedBy: tenant.getUserId(),
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      published += 1;
    } catch (err) {
      logger.error({ err, itemId: String(item._id) }, "Could not publish a payslip");
    }
  }

  // Notify in one pass rather than per payslip.
  const employees = await Employee.find({
    _id: { $in: items.map((i) => i.employeeId) },
    userId: { $ne: null },
  })
    .select("userId personal.firstName personal.workEmail")
    .lean();

  await notifications
    .notify({
      template: "payslip_published",
      recipients: employees.map((e) => ({
        userId: e.userId,
        employeeId: e._id,
        email: e.personal.workEmail,
        firstName: e.personal.firstName,
      })),
      organization,
      data: { period: { label: period.name }, payslip: { id: "" } },
      entity: { type: "PayrollRun", id: run._id },
    })
    .catch((err) => logger.warn({ err }, "Payslip notifications failed"));

  await audit.record(
    {
      action: "payroll.payslips_published",
      entityType: "PayrollRun",
      entityId: run._id,
      entityLabel: period.name,
      after: { published },
      severity: "warning",
    },
    req
  );

  return { published, total: items.length };
}

// ── Reads ───────────────────────────────────────────────────────────────────

async function listRuns(query = {}) {
  const { page, limit, skip } = parseListQuery(query, {
    allowedSort: ["createdAt"],
    defaultSort: "-createdAt",
  });

  const filter = {};
  if (query.periodId) filter.periodId = query.periodId;
  if (query.status) filter.status = query.status;

  const [items, total] = await Promise.all([
    PayrollRun.find(filter)
      .populate("periodId", "name year month startDate endDate payDate")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    PayrollRun.countDocuments(filter),
  ]);

  return { items, page, limit, total };
}

async function getRun(runId) {
  const run = await PayrollRun.findById(runId).populate("periodId").lean();
  if (!run) throw AppError.notFound("Payroll run");
  return run;
}

async function listItems(runId, query = {}) {
  const { page, limit, skip } = parseListQuery(query, {
    allowedSort: ["net", "gross"],
    defaultSort: "employeeSnapshot.employeeCode",
    maxLimit: 500,
  });

  const filter = { runId };
  if (query.status) filter.status = query.status;
  if (query.q) {
    const rx = new RegExp(String(query.q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [{ "employeeSnapshot.employeeCode": rx }, { "employeeSnapshot.name": rx }];
  }

  const [items, total] = await Promise.all([
    PayrollItem.find(filter).sort({ "employeeSnapshot.employeeCode": 1 }).skip(skip).limit(limit).lean(),
    PayrollItem.countDocuments(filter),
  ]);

  return { items, page, limit, total };
}

async function getItem(itemId, auth) {
  const item = await PayrollItem.findById(itemId).lean();
  if (!item) throw AppError.notFound("Payroll item");
  await employeeService.assertCanView(auth, item.employeeId);
  return item;
}

/** An employee's own payslips. */
async function myPayslips(employeeId, query = {}) {
  const filter = { employeeId };
  if (query.year) {
    const periods = await PayrollPeriod.find({ year: Number(query.year) }).select("_id").lean();
    filter.periodId = { $in: periods.map((p) => p._id) };
  }

  return Payslip.find(filter)
    .populate("periodId", "name year month payDate")
    .sort({ publishedAt: -1 })
    .limit(48)
    .lean();
}

async function getPayslip(payslipId, auth) {
  const payslip = await Payslip.findById(payslipId).populate("periodId").lean();
  if (!payslip) throw AppError.notFound("Payslip");

  const isOwn = auth.employeeId && String(auth.employeeId) === String(payslip.employeeId);
  if (!isOwn && !(auth.permissions || []).includes("payroll.view")) {
    throw AppError.notFound("Payslip");
  }

  if (isOwn && !payslip.viewedAt) {
    await Payslip.updateOne({ _id: payslipId }, { $set: { viewedAt: new Date() } });
  }

  return payslip;
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

module.exports = {
  ensurePeriod,
  listPeriods,
  salaryFor,
  assignSalary,
  salaryHistory,
  attendanceInputFor,
  createRun,
  processRun,
  addAdjustment,
  approveRun,
  lockRun,
  publishPayslips,
  listRuns,
  getRun,
  listItems,
  getItem,
  myPayslips,
  getPayslip,
  recalculateRunTotals,
  SalaryComponent,
  SalaryStructure,
  EmployeeSalary,
  PayrollPeriod,
  PayrollRun,
  PayrollItem,
  Payslip,
};
