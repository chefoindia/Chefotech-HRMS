"use strict";

const Employee = require("../employees/employee.model");
const Membership = require("../rbac/membership.model");
const User = require("../users/user.model");
const { LeaveRequest, LeaveDay } = require("../leave/leave.model");
const { AttendanceRecord, AttendanceCorrection } = require("../attendance/attendance.model");
const notifications = require("./notification.service");
const recipients = require("./recipients");
const preferences = require("./preference.service");
const dt = require("../../shared/datetime");
const { env } = require("../../config/env");

/**
 * The morning digest.
 *
 * One email, once a day, to each manager and HR user, listing what is
 * waiting on them and what is happening today — instead of a dozen separate
 * messages spread across the previous evening. The digest time was a setting
 * for months before anything read it.
 *
 * A person only gets a digest when there is something in it. An empty
 * "nothing to report" email every morning is how people learn to delete the
 * real ones unread.
 */

const ACTIVE = ["active", "on_leave", "notice_period"];

function name(e) {
  return [e.personal.firstName, e.personal.lastName].filter(Boolean).join(" ");
}

/** Everyone who might want a digest: anyone who can approve or see the org. */
async function candidates() {
  const memberships = await Membership.find({
    status: "active",
    permissions: { $in: ["leave.approve", "attendance.approve", "workflow.act", "employee.view"] },
  })
    .select("userId employeeId permissions")
    .lean();
  if (!memberships.length) return [];

  const users = await User.find({ _id: { $in: memberships.map((m) => m.userId) }, status: "active" })
    .select("email firstName lastName")
    .lean();
  const byUser = Object.fromEntries(users.map((u) => [String(u._id), u]));

  return memberships
    .filter((m) => byUser[String(m.userId)])
    .map((m) => ({ user: byUser[String(m.userId)], employeeId: m.employeeId, permissions: m.permissions }));
}

/** Build one person's digest. Returns null when there is nothing to say. */
async function buildFor({ user, employeeId, permissions }, { today, timezone, locale }) {
  const has = (p) => permissions.includes(p);
  const orgWide = has("employee.view");

  // The scope this person sees: everyone, or their reporting tree.
  let teamIds = null;
  if (!orgWide && employeeId) {
    const team = await Employee.find({ "employment.managerChain": employeeId, status: { $in: ACTIVE } })
      .select("_id")
      .lean();
    teamIds = team.map((t) => t._id);
  }
  const scope = (field = "employeeId") => (teamIds ? { [field]: { $in: teamIds } } : {});
  if (!orgWide && (!teamIds || !teamIds.length)) return null;

  const yesterday = dt.addDays(today, -1);
  const sections = [];

  // ── Waiting on you ─────────────────────────────────────────────────────
  const waiting = [];
  if (has("leave.approve")) {
    const count = await LeaveRequest.countDocuments({ status: "pending", ...scope() });
    if (count) waiting.push(`${count} leave request${count === 1 ? "" : "s"}`);
  }
  if (has("attendance.approve")) {
    const corrections = await AttendanceCorrection.countDocuments({ status: "pending", ...scope() });
    if (corrections) waiting.push(`${corrections} attendance correction${corrections === 1 ? "" : "s"}`);
    const overtime = await AttendanceRecord.countDocuments({ overtimeStatus: "pending", ...scope() });
    if (overtime) waiting.push(`${overtime} overtime approval${overtime === 1 ? "" : "s"}`);
  }
  if (has("workflow.act")) {
    const workflowService = require("../workflow/workflow.service");
    const pending = await workflowService.pendingFor(user._id, { limit: 1 }).catch(() => null);
    const total = pending && pending.total ? pending.total : 0;
    if (total) waiting.push(`${total} other approval${total === 1 ? "" : "s"}`);
  }
  if (waiting.length) sections.push(`WAITING ON YOU\n${waiting.map((w) => `• ${w}`).join("\n")}`);

  // ── Today ──────────────────────────────────────────────────────────────
  const offToday = await LeaveDay.find({ date: today, status: "approved", deductedDays: { $gt: 0 }, ...scope() })
    .populate("employeeId", "personal.firstName personal.lastName")
    .limit(30)
    .lean();
  if (offToday.length) {
    const names = offToday.filter((d) => d.employeeId).map((d) => name(d.employeeId));
    sections.push(`ON LEAVE TODAY (${names.length})\n${names.slice(0, 15).join(", ")}${names.length > 15 ? "…" : ""}`);
  }

  const absent = await AttendanceRecord.find({ date: yesterday, status: "absent", ...scope() })
    .populate("employeeId", "personal.firstName personal.lastName")
    .limit(30)
    .lean();
  if (absent.length) {
    const names = absent.filter((r) => r.employeeId).map((r) => name(r.employeeId));
    sections.push(`ABSENT YESTERDAY WITHOUT LEAVE (${names.length})\n${names.slice(0, 15).join(", ")}${names.length > 15 ? "…" : ""}`);
  }

  if (orgWide) {
    const joiners = await Employee.find({
      "employment.joiningDate": { $gte: dt.startOfDay(today, timezone), $lte: dt.endOfDay(today, timezone) },
    })
      .select("personal")
      .lean();
    if (joiners.length) sections.push(`JOINING TODAY\n${joiners.map(name).join(", ")}`);

    const birthdays = await Employee.aggregate([
      { $match: { status: { $in: ACTIVE }, "personal.dateOfBirth": { $ne: null } } },
      { $addFields: { md: { $dateToString: { date: "$personal.dateOfBirth", format: "%m-%d", timezone } } } },
      { $match: { md: today.slice(5) } },
      { $project: { personal: 1 } },
    ]);
    if (birthdays.length) sections.push(`BIRTHDAYS TODAY\n${birthdays.map(name).join(", ")}`);

    if (has("document.view")) {
      const documentService = require("../documents/document.service");
      const expiring = await documentService.expiring(7).catch(() => []);
      if (expiring.length) {
        const lines = expiring
          .slice(0, 10)
          .map((d) => `• ${d.name} — ${d.employeeId ? name(d.employeeId) : "unknown"} (${dt.toDateString(d.expiresOn, timezone)})`);
        sections.push(`DOCUMENTS EXPIRING THIS WEEK\n${lines.join("\n")}`);
      }
    }
  }

  if (!sections.length) return null;

  const dateLabel = new Date(`${today}T12:00:00Z`).toLocaleDateString(locale || "en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return {
    dateLabel,
    body: `Hi ${user.firstName},\n\n${sections.join("\n\n")}\n\nOpen ${env.app.publicUrl}/app/approvals to act on anything waiting.`,
  };
}

/** Send the digest to everyone in this organization who wants one. */
async function sendAll({ date } = {}) {
  const organization = await recipients.organization();
  const timezone = organization.timezone;
  const today = date || dt.todayString(timezone);
  const people = await candidates();

  let sent = 0;
  let empty = 0;
  for (const person of people) {
    const pref = await preferences.forUser(person.user._id);
    if (!pref.dailyDigest || !pref.emailEnabled) continue;

    const digest = await buildFor(person, { today, timezone, locale: organization.locale });
    if (!digest) {
      empty += 1;
      continue;
    }

    const outcome = await notifications.notify({
      template: "daily_digest",
      recipients: [recipients.userToRecipient(person.user)],
      organization,
      data: { digest },
      channels: ["email"],
    });
    sent += outcome.sent;
  }
  return { candidates: people.length, sent, empty };
}

/** What today's digest would say to one user — for the settings preview. */
async function previewFor(auth) {
  const organization = await recipients.organization();
  const today = dt.todayString(organization.timezone);
  const user = await User.findById(auth.userId).select("email firstName lastName").lean();
  const digest = await buildFor(
    { user, employeeId: auth.employeeId, permissions: auth.permissions || [] },
    { today, timezone: organization.timezone, locale: organization.locale }
  );
  return digest || { dateLabel: today, body: "Nothing to report today — you would not receive an email." };
}

module.exports = { sendAll, buildFor, previewFor, candidates };
