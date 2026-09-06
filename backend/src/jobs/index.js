"use strict";

const queue = require("../core/jobs/queue");
const { logger } = require("../config/logger");

/**
 * Job handler registration.
 *
 * Handlers run inside the tenant context of the job's organization (see
 * queue.js), so they can use the models exactly as a request handler would.
 * Every handler must be idempotent: delivery is at-least-once and a worker
 * that dies mid-run will have its job reclaimed and retried.
 */
function registerJobs() {
  // ── Attendance ────────────────────────────────────────────────────────────

  queue.register("attendance.process-range", async (payload) => {
    const attendanceService = require("../modules/attendance/attendance.service");
    return attendanceService.processRange(payload);
  });

  /**
   * Nightly finalisation: recompute yesterday for everyone, so late biometric
   * syncs and approved leave are reflected before anyone looks at a report.
   */
  queue.register("attendance.daily-finalise", async (payload) => {
    const attendanceService = require("../modules/attendance/attendance.service");
    const dt = require("../shared/datetime");

    const timezone = await attendanceService.organizationTimezone();
    const date = payload.date || dt.addDays(dt.todayString(timezone), -1);

    return attendanceService.processRange({ fromDate: date, toDate: date });
  });

  // ── Biometric ─────────────────────────────────────────────────────────────

  queue.register("biometric.sync-device", async (payload) => {
    const biometricService = require("../modules/biometric/biometric.service");
    return biometricService.syncDevice(payload.deviceId, { trigger: "scheduled" });
  });

  queue.register("biometric.sync-due", async () => {
    const biometricService = require("../modules/biometric/biometric.service");
    return biometricService.syncDueDevices();
  });

  // ── Payroll ───────────────────────────────────────────────────────────────

  queue.register("payroll.process-run", async (payload) => {
    const payrollService = require("../modules/payroll/payroll.service");
    const run = await payrollService.processRun(payload.runId);
    return {
      runId: String(run._id),
      status: run.status,
      employees: run.totals.employeeCount,
      errors: run.exceptions.length,
    };
  });

  // ── Leave ─────────────────────────────────────────────────────────────────

  /** Monthly accrual for leave types configured to earn per completed month. */
  queue.register("leave.monthly-accrual", async (payload) => {
    const leaveService = require("../modules/leave/leave.service");
    const { LeaveType, LeaveBalance } = require("../modules/leave/leave.model");
    const Employee = require("../modules/employees/employee.model");
    const dt = require("../shared/datetime");

    const today = payload.date || dt.todayString();
    const month = Number(today.slice(5, 7));

    const employees = await Employee.find({
      status: { $in: ["active", "on_leave", "notice_period"] },
    })
      .select("employment.leavePolicyId employment.joiningDate")
      .lean();

    const types = await LeaveType.find({ isActive: true, hasBalance: true }).lean();

    let credited = 0;

    for (const employee of employees) {
      const policy = await leaveService.resolvePolicy(employee);
      if (!policy) continue;

      for (const leaveType of types) {
        const rule = leaveService.ruleFor(policy, leaveType._id);
        if (!rule || !rule.allocation) continue;
        if (!["accrual", "monthly"].includes(rule.allocation.mode)) continue;

        const balance = await leaveService.getOrCreateBalance(employee, leaveType, today, policy);

        // The watermark makes this idempotent: running the job twice in a
        // month credits once.
        if (balance.lastAccruedMonth === month) continue;

        const days =
          rule.allocation.mode === "accrual"
            ? rule.allocation.accrualPerMonth || 0
            : rule.allocation.daysPerPeriod || 0;

        if (days <= 0) continue;

        const cap = rule.allocation.maximumBalance || 0;
        if (cap > 0 && balance.available + days > cap) {
          const room = Math.max(0, cap - balance.available);
          if (room <= 0) continue;
          await leaveService.adjustBalance(balance, {
            field: "allocated",
            type: "accrual",
            days: room,
            note: `Monthly accrual capped at the maximum balance of ${cap}`,
          });
        } else {
          await leaveService.adjustBalance(balance, {
            field: "allocated",
            type: "accrual",
            days,
            note: `Monthly accrual for ${today.slice(0, 7)}`,
          });
        }

        balance.lastAccruedMonth = month;
        await balance.save();
        credited += 1;
      }
    }

    logger.info({ credited }, "Monthly leave accrual complete");
    return { credited, employees: employees.length };
  });

  /** Year-end: carry forward what the policy allows, lapse the rest. */
  queue.register("leave.year-end-carry-forward", async (payload) => {
    const leaveService = require("../modules/leave/leave.service");
    const leaveEngine = require("../modules/leave/leaveEngine");
    const { LeaveBalance, LeaveType } = require("../modules/leave/leave.model");
    const Employee = require("../modules/employees/employee.model");

    const closingYear = payload.year || new Date().getFullYear() - 1;
    const balances = await LeaveBalance.find({ year: closingYear }).lean();

    let processed = 0;

    for (const old of balances) {
      const employee = await Employee.findById(old.employeeId).lean();
      if (!employee || !["active", "on_leave", "notice_period"].includes(employee.status)) continue;

      const leaveType = await LeaveType.findById(old.leaveTypeId).lean();
      if (!leaveType) continue;

      const policy = await leaveService.resolvePolicy(employee);
      const rule = leaveService.ruleFor(policy, old.leaveTypeId);
      if (!rule) continue;

      const closing =
        old.opening + old.allocated + old.carriedForward + old.credited + old.adjustment -
        old.used - old.pending - old.encashed - old.lapsed;

      const { carried, lapsed, breakdown } = leaveEngine.computeCarryForward({
        rule,
        closingBalance: closing,
      });

      if (lapsed > 0) {
        await LeaveBalance.updateOne(
          { _id: old._id },
          {
            $inc: { lapsed },
            $push: {
              history: {
                at: new Date(),
                type: "lapse",
                days: -lapsed,
                note: breakdown[0].detail,
              },
            },
          }
        );
      }

      if (carried > 0) {
        const nextBalance = await leaveService.getOrCreateBalance(
          employee,
          leaveType,
          `${closingYear + 1}-06-15`,
          policy
        );
        // Idempotency: never carry twice into the same year.
        const alreadyCarried = (nextBalance.history || []).some(
          (h) => h.type === "carry_forward" && h.reference === String(closingYear)
        );
        if (!alreadyCarried) {
          await leaveService.adjustBalance(nextBalance, {
            field: "carriedForward",
            type: "carry_forward",
            days: carried,
            note: `Carried forward from ${closingYear}`,
            reference: String(closingYear),
          });
        }
      }

      processed += 1;
    }

    logger.info({ processed, closingYear }, "Leave carry-forward complete");
    return { processed, closingYear };
  });

  // ── Documents ─────────────────────────────────────────────────────────────

  queue.register("documents.expiry-reminders", async () => {
    const documentService = require("../modules/documents/document.service");
    const notifications = require("../modules/notifications/notification.service");
    const settings = require("../core/settings/settings.service");
    const Organization = require("../modules/organizations/organization.model");
    const tenantCtx = require("../core/tenancy/tenantContext");
    const { EmployeeDocument } = require("../modules/documents/document.model");

    const thresholds = await settings.get("notification.document_expiry_reminder_days");
    const documents = await documentService.expiring(Math.max(...thresholds, 30));

    const organization = await tenantCtx.runAsSystem(
      () => Organization.findById(tenantCtx.requireOrganizationId()).lean(),
      "documents.reminders"
    );

    let sent = 0;

    for (const document of documents) {
      const daysLeft = Math.ceil((new Date(document.expiresOn) - Date.now()) / 86400000);
      const threshold = thresholds.find((t) => t === daysLeft);
      if (threshold === undefined) continue;

      // The watermark stops a reminder going out twice for the same threshold.
      if ((document.expiryRemindersSent || []).includes(threshold)) continue;

      const employee = document.employeeId;
      if (!employee || !employee.userId) continue;

      await notifications
        .notify({
          template: "document_expiring",
          recipients: [
            {
              userId: employee.userId,
              employeeId: employee._id,
              email: employee.personal.workEmail,
              firstName: employee.personal.firstName,
            },
          ],
          organization,
          data: {
            document: {
              name: document.name,
              expiresOn: document.expiresOn,
              daysLeft,
            },
            employee: {
              id: String(employee._id),
              name: [employee.personal.firstName, employee.personal.lastName].filter(Boolean).join(" "),
            },
          },
          entity: { type: "EmployeeDocument", id: document._id },
        })
        .catch(() => {});

      await EmployeeDocument.updateOne(
        { _id: document._id },
        { $addToSet: { expiryRemindersSent: threshold } }
      );
      sent += 1;
    }

    return { sent, checked: documents.length };
  });

  /** Many letters at once, delivered as a zip. */
  queue.register("documents.bulk-generate", async (payload) => {
    const documentService = require("../modules/documents/document.service");
    return documentService.runBulkGenerate(payload);
  });

  /** "Please acknowledge" and "please upload" nudges, every three days. */
  queue.register("documents.reminders", async () => {
    const documentService = require("../modules/documents/document.service");
    const [acknowledgements, requests] = await Promise.all([
      documentService.sendAcknowledgementReminders(),
      documentService.sendRequestReminders(),
    ]);
    return { acknowledgements, requests };
  });

  // ── Lifecycle: onboarding, exits, scheduled movements ─────────────────────

  /** Tick self-completing joining tasks and chase overdue ones. */
  queue.register("onboarding.daily", async () => {
    const onboarding = require("../modules/onboarding/onboarding.service");
    const auto = await onboarding.runAutoCompletions();
    const reminders = await onboarding.sendReminders();
    return { auto, reminders };
  });

  /** Promotions, transfers and confirmations dated today (or missed) apply themselves. */
  queue.register("employees.apply-changes", async () => {
    const changes = require("../modules/employees/change.service");
    return changes.applyDue();
  });

  // ── Surveys ───────────────────────────────────────────────────────────────

  /** Close surveys past their date; remind people two days before. */
  queue.register("surveys.daily", async () => {
    const surveys = require("../modules/surveys/survey.service");
    return surveys.runDaily();
  });

  // ── Scheduled sheets and data export ──────────────────────────────────────

  /** Sheets due this hour, in the organization's own time zone. */
  queue.register("sheets.run-schedules", async () => {
    const schedules = require("../modules/documents/sheetSchedule.service");
    return schedules.runDue();
  });

  /** A full export of the organization's data as a zip of JSON files. */
  queue.register("organization.export", async (payload) => {
    const exporter = require("../modules/organizations/export.service");
    return exporter.run(payload);
  });

  // ── Integrations ──────────────────────────────────────────────────────────

  /** One webhook delivery; throws on a non-2xx so the queue retries with backoff. */
  queue.register("webhooks.deliver", async (payload) => {
    const integrations = require("../modules/integrations/integration.service");
    const delivery = await integrations.deliver(payload.deliveryId);
    return delivery ? { status: delivery.status, attempts: delivery.attempts, responseStatus: delivery.responseStatus } : { skipped: true };
  });

  // ── Assets ────────────────────────────────────────────────────────────────

  /** "That laptop was due back last week" — every three days until it is. */
  queue.register("assets.return-reminders", async () => {
    const assetService = require("../modules/assets/asset.service");
    return assetService.sendReturnReminders();
  });

  // ── Workflow ──────────────────────────────────────────────────────────────

  queue.register("workflow.process-overdue", async () => {
    const workflowService = require("../modules/workflow/workflow.service");
    return workflowService.processOverdue();
  });

  // ── Housekeeping ──────────────────────────────────────────────────────────

  queue.register("organization.recalculate-usage", async () => {
    const Employee = require("../modules/employees/employee.model");
    const Organization = require("../modules/organizations/organization.model");
    const storage = require("../core/storage/storage.service");
    const tenantCtx = require("../core/tenancy/tenantContext");

    const organizationId = tenantCtx.requireOrganizationId();

    const [employeeCount, activeEmployeeCount, storageBytes] = await Promise.all([
      Employee.countDocuments({}),
      Employee.countDocuments({ status: { $in: ["active", "on_leave", "notice_period"] } }),
      storage.StoredFile.aggregate([{ $group: { _id: null, total: { $sum: "$size" } } }])
        .then((r) => (r[0] ? r[0].total : 0))
        .catch(() => 0),
    ]);

    await tenantCtx.runAsSystem(
      () =>
        Organization.updateOne(
          { _id: organizationId },
          {
            $set: {
              "usage.employeeCount": employeeCount,
              "usage.activeEmployeeCount": activeEmployeeCount,
              "usage.storageBytes": storageBytes,
              "usage.lastRecalculatedAt": new Date(),
            },
          }
        ),
      "usage.recalculate"
    );

    return { employeeCount, activeEmployeeCount, storageBytes };
  });

  // ── Mail and push ─────────────────────────────────────────────────────────

  /**
   * One email. The MailMessage row already exists; this attempts delivery
   * and records the outcome. A provider failure throws, which is what gives
   * it the queue's retry and backoff.
   */
  queue.register("mail.send", async (payload) => {
    const outbound = require("../modules/notifications/outbound.service");
    return outbound.sendNow(payload.messageId);
  });

  queue.register("push.send", async (payload) => {
    const push = require("../modules/notifications/push.service");
    return push.sendToUser(payload.userId, payload.message);
  });

  /** Global, not per tenant: device tokens belong to users. */
  queue.register("push.check-receipts", async () => {
    const push = require("../modules/notifications/push.service");
    return push.checkReceipts();
  });

  // ── Notifications driven by the calendar ──────────────────────────────────

  queue.register("notification.daily-events", async (payload) => {
    const dailyEvents = require("../modules/notifications/dailyEvents.service");
    const attendanceService = require("../modules/attendance/attendance.service");
    const timezone = await attendanceService.organizationTimezone();
    return dailyEvents.run({ date: payload.date, timezone });
  });

  queue.register("notification.daily-digest", async (payload) => {
    const digest = require("../modules/notifications/digest.service");
    return digest.sendAll({ date: payload.date });
  });

  queue.register("announcements.send-due", async () => {
    const announcements = require("../modules/notifications/announcement.service");
    return announcements.sendDue();
  });

  logger.info({ handlers: queue.registeredJobs().length }, "Job handlers registered");
}

module.exports = registerJobs;
