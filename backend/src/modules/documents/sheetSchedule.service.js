"use strict";

const { SheetSchedule } = require("./sheetSchedule.model");
const SheetTemplate = require("./sheetTemplate.model");
const sheets = require("./sheet.service");
const { PayrollRun } = require("../payroll/payroll.model");
const Organization = require("../organizations/organization.model");
const storage = require("../../core/storage/storage.service");
const outbound = require("../notifications/outbound.service");
const mailer = require("../notifications/mailer");
const notifications = require("../notifications/notification.service");
const recipients = require("../notifications/recipients");
const { AppError } = require("../../core/errors/AppError");
const audit = require("../../core/audit/audit.service");
const tenant = require("../../core/tenancy/tenantContext");
const { logger } = require("../../config/logger");
const dt = require("../../shared/datetime");

/** Scheduled sheets. See sheetSchedule.model.js. */

async function list(sheetId) {
  const filter = sheetId ? { sheetId } : {};
  const rows = await SheetSchedule.find(filter).populate("sheetId", "name code source").sort({ createdAt: -1 }).lean();
  return rows.map(shape);
}

async function create(data, req) {
  const sheet = await SheetTemplate.findById(data.sheetId).lean();
  if (!sheet) throw AppError.notFound("Sheet");
  const schedule = await SheetSchedule.create({ ...data, createdBy: tenant.getUserId() });
  await audit.record({ action: "sheetschedule.created", entityType: "SheetSchedule", entityId: schedule._id, entityLabel: `${sheet.name} — ${data.frequency}`, after: { recipients: data.recipients, period: data.period, format: data.format }, severity: "notice" }, req);
  return shape(await SheetSchedule.findById(schedule._id).populate("sheetId", "name code source").lean());
}

async function update(id, data, req) {
  const schedule = await SheetSchedule.findById(id);
  if (!schedule) throw AppError.notFound("Schedule");
  Object.assign(schedule, data, { updatedBy: tenant.getUserId() });
  await schedule.save();
  await audit.record({ action: "sheetschedule.updated", entityType: "SheetSchedule", entityId: schedule._id, entityLabel: schedule.name, severity: "notice" }, req);
  return shape(await SheetSchedule.findById(schedule._id).populate("sheetId", "name code source").lean());
}

async function remove(id, req) {
  const schedule = await SheetSchedule.findById(id);
  if (!schedule) throw AppError.notFound("Schedule");
  await schedule.softDelete(tenant.getUserId());
  await audit.record({ action: "sheetschedule.deleted", entityType: "SheetSchedule", entityId: schedule._id, entityLabel: schedule.name, severity: "warning" }, req);
  return { id: String(id), deleted: true };
}

/** Turn a relative period into the filters the source needs, as of now. */
async function resolvePeriod(period, timezone) {
  const today = dt.todayString(timezone);
  const [y, m] = today.slice(0, 7).split("-").map(Number);
  switch (period) {
    case "yesterday": {
      const d = dt.addDays(today, -1);
      return { fromDate: d, toDate: d };
    }
    case "last_7_days":
      return { fromDate: dt.addDays(today, -7), toDate: dt.addDays(today, -1) };
    case "this_week": {
      const dow = dt.weekdayIndex(today);
      const start = dt.addDays(today, -((dow + 6) % 7));
      return { fromDate: start, toDate: today };
    }
    case "last_week": {
      const dow = dt.weekdayIndex(today);
      const thisStart = dt.addDays(today, -((dow + 6) % 7));
      return { fromDate: dt.addDays(thisStart, -7), toDate: dt.addDays(thisStart, -1) };
    }
    case "this_month": {
      const b = dt.monthBounds(y, m);
      return { fromDate: b.start, toDate: today, year: y };
    }
    case "last_month": {
      const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
      const b = dt.monthBounds(prev.y, prev.m);
      return { fromDate: b.start, toDate: b.end, year: prev.y };
    }
    case "last_payroll_run": {
      const run = await PayrollRun.findOne({ status: { $in: ["processed", "approved", "locked", "paid"] } }).sort({ processedAt: -1 }).select("_id").lean();
      return run ? { runId: String(run._id) } : {};
    }
    default:
      return {};
  }
}

/** Is this schedule due in the hour that just began, in the organization's zone? */
function isDue(schedule, now) {
  if (!schedule.isActive) return false;
  if (now.hour() !== schedule.hour) return false;
  if (schedule.frequency === "weekly" && now.day() !== schedule.dayOfWeek) return false;
  if (schedule.frequency === "monthly" && now.date() !== schedule.dayOfMonth) return false;
  const key = now.format("YYYY-MM-DD-HH");
  return schedule.lastFiredKey !== key;
}

/** Hourly sweep for one organization. */
async function runDue() {
  const organization = await tenant.runAsSystem(() => Organization.findById(tenant.requireOrganizationId()).lean(), "sheets.schedules");
  const now = dt.nowIn(organization.timezone);
  const schedules = await SheetSchedule.find({ isActive: true }).lean();
  let ran = 0;
  for (const schedule of schedules) {
    if (!isDue(schedule, now)) continue;
    await SheetSchedule.updateOne({ _id: schedule._id }, { $set: { lastFiredKey: now.format("YYYY-MM-DD-HH") } });
    await run(schedule._id, { organization }).catch((err) => logger.warn({ err, scheduleId: String(schedule._id) }, "Scheduled sheet failed"));
    ran += 1;
  }
  return { checked: schedules.length, ran };
}

/** Render, store, email. Also the "run now" button. */
async function run(id, { organization = null, req = null } = {}) {
  const schedule = await SheetSchedule.findById(id).populate("sheetId", "name code source").lean();
  if (!schedule) throw AppError.notFound("Schedule");
  const org = organization || (await tenant.runAsSystem(() => Organization.findById(tenant.requireOrganizationId()).lean(), "sheets.schedules"));
  const creator = await require("../users/user.model").findById(schedule.createdBy).select("email firstName lastName").lean();

  // The creator's permissions decide what the sheet may contain — a schedule
  // never widens what its author could see themselves.
  const rbac = require("../rbac/rbac.service");
  const access = schedule.createdBy ? await rbac.resolveAccess(tenant.requireOrganizationId(), String(schedule.createdBy)) : null;
  const auth = { userId: String(schedule.createdBy), permissions: access ? access.permissions : [], name: creator ? [creator.firstName, creator.lastName].filter(Boolean).join(" ") : "Scheduled" };

  try {
    const filters = { ...(schedule.filters || {}), ...(await resolvePeriod(schedule.period, org.timezone)) };
    const result = await sheets.render(String(schedule.sheetId._id), { filters, format: schedule.format }, auth);
    const stored = await storage.save({
      buffer: result.buffer,
      originalName: result.fileName,
      mimeType: result.mimeType.split(";")[0],
      category: "export",
      ownerType: "SheetSchedule",
      ownerId: schedule._id,
      orgFolderName: `${org.slug}-${String(org._id).slice(-6)}`,
      metadata: { scheduleId: String(schedule._id), rows: result.rowCount },
      uploadedBy: schedule.createdBy,
    });

    const subject = schedule.subject || `${schedule.sheetId.name} — ${describePeriod(schedule.period)}`;
    const text = `${schedule.message ? `${schedule.message}\n\n` : ""}${schedule.sheetId.name} is attached (${result.rowCount} row${result.rowCount === 1 ? "" : "s"}, ${describePeriod(schedule.period)}).\n\nSent automatically by ${org.name} HRMS.`;
    for (const to of schedule.recipients || []) {
      await outbound.deliverEmail({
        to,
        subject,
        text,
        html: mailer.wrapHtml({ title: subject, body: text, branding: org.branding || {}, companyName: org.name, actionUrl: null }),
        templateKey: "sheet_schedule",
        event: "report.scheduled",
        organizationId: org._id,
        meta: { attachmentFileIds: [String(stored._id)], scheduleId: String(schedule._id) },
      });
    }

    await SheetSchedule.updateOne({ _id: schedule._id }, { $set: { lastRunAt: new Date(), lastRunStatus: "ok", lastError: null, lastFileId: stored._id } });
    if (creator) {
      notifications
        .notify({ template: "announcement", recipients: [recipients.userToRecipient(creator)], organization: org, data: { title: `${schedule.sheetId.name} was sent`, message: `${result.rowCount} rows, ${describePeriod(schedule.period)}, to ${schedule.recipients.length} recipient${schedule.recipients.length === 1 ? "" : "s"}.` }, channels: ["in_app"], entity: { type: "StoredFile", id: stored._id } })
        .catch(() => {});
    }
    await audit.record({ action: "sheetschedule.ran", entityType: "SheetSchedule", entityId: schedule._id, entityLabel: schedule.name, after: { rows: result.rowCount, recipients: schedule.recipients.length }, severity: "info" }, req);
    return { ok: true, rows: result.rowCount, fileId: String(stored._id), recipients: schedule.recipients.length };
  } catch (err) {
    await SheetSchedule.updateOne({ _id: schedule._id }, { $set: { lastRunAt: new Date(), lastRunStatus: "failed", lastError: err.message } });
    if (creator) {
      notifications
        .notify({ template: "announcement", recipients: [recipients.userToRecipient(creator)], organization: org, data: { title: `${schedule.sheetId.name} could not be sent`, message: err.message }, severity: "warning", channels: ["in_app", "email"] })
        .catch(() => {});
    }
    throw err;
  }
}

function describePeriod(period) {
  return { yesterday: "yesterday", last_7_days: "the last 7 days", this_week: "this week", last_week: "last week", this_month: "this month so far", last_month: "last month", last_payroll_run: "the latest payroll run", none: "" }[period] || "";
}

function shape(s) {
  return {
    id: String(s._id),
    sheet: s.sheetId && s.sheetId.name ? { id: String(s.sheetId._id), name: s.sheetId.name, code: s.sheetId.code, source: s.sheetId.source } : { id: String(s.sheetId) },
    name: s.name,
    frequency: s.frequency,
    dayOfWeek: s.dayOfWeek,
    dayOfMonth: s.dayOfMonth,
    hour: s.hour,
    period: s.period,
    format: s.format,
    filters: s.filters || {},
    recipients: s.recipients || [],
    subject: s.subject,
    message: s.message,
    isActive: s.isActive,
    lastRunAt: s.lastRunAt,
    lastRunStatus: s.lastRunStatus,
    lastError: s.lastError,
    lastFileId: s.lastFileId ? String(s.lastFileId) : null,
    createdAt: s.createdAt,
  };
}

module.exports = { list, create, update, remove, run, runDue, resolvePeriod, isDue, SheetSchedule };
