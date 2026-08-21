"use strict";

/**
 * Built-in notification and email templates.
 *
 * Every template is overridable per organization (see EmailTemplate); these
 * are the defaults a tenant starts from. Bodies use {{dotted.path}}
 * placeholders resolved against the event data plus `company` and `recipient`,
 * which the service always injects.
 */

const TEMPLATES = {
  // ── Account ──────────────────────────────────────────────────────────────
  welcome: {
    event: "account.welcome",
    channels: ["email"],
    subject: "Welcome to {{company.name}} on Chefotech HRMS",
    title: "Welcome aboard",
    body:
      "Hi {{firstName}},\n\n" +
      "Your Chefotech HRMS workspace for {{companyName}} is ready.\n\n" +
      "Please confirm your email address to finish setting up:\n{{verifyUrl}}\n\n" +
      "— The Chefotech team",
  },
  duplicate_signup_attempt: {
    event: "account.duplicate_signup",
    channels: ["email"],
    subject: "Someone tried to sign up with your email",
    title: "Sign-up attempt",
    body:
      "Hi {{firstName}},\n\n" +
      "Someone just tried to create a Chefotech HRMS account with this email address. " +
      "You already have one, so nothing has changed.\n\n" +
      "If this was you, sign in instead. If it was not, you can safely ignore this message.",
  },
  password_reset: {
    event: "account.password_reset",
    channels: ["email"],
    subject: "Reset your Chefotech HRMS password",
    title: "Password reset",
    body:
      "Hi {{firstName}},\n\n" +
      "Use this link to choose a new password. It expires in {{expiresInMinutes}} minutes:\n\n" +
      "{{resetUrl}}\n\n" +
      "If you did not ask for this, no action is needed — your password has not changed.",
  },
  user_invitation: {
    event: "account.invited",
    channels: ["email"],
    subject: "{{inviterName}} invited you to {{company.name}}",
    title: "You have been invited",
    body:
      "Hi {{firstName}},\n\n" +
      "{{inviterName}} has invited you to join {{company.name}} on Chefotech HRMS as {{roleName}}.\n\n" +
      "Set your password to get started:\n{{acceptUrl}}\n\n" +
      "This invitation expires in {{expiresInDays}} days.",
  },

  // ── Leave ────────────────────────────────────────────────────────────────
  leave_applied: {
    event: "leave.applied",
    channels: ["in_app", "email"],
    subject: "Leave request from {{employee.name}}",
    title: "New leave request",
    body:
      "{{employee.name}} has applied for {{leave.type}} from {{leave.from}} to {{leave.to}} " +
      "({{leave.days}} day(s)).\n\nReason: {{leave.reason}}",
    actionUrl: "/app/approvals",
  },
  leave_approved: {
    event: "leave.approved",
    channels: ["in_app", "email", "push"],
    subject: "Your leave has been approved",
    title: "Leave approved",
    body:
      "Hi {{employee.firstName}},\n\n" +
      "Your {{leave.type}} from {{leave.from}} to {{leave.to}} has been approved by {{approver.name}}.",
    actionUrl: "/me/leave",
  },
  leave_rejected: {
    event: "leave.rejected",
    channels: ["in_app", "email", "push"],
    subject: "Your leave request was not approved",
    title: "Leave rejected",
    body:
      "Hi {{employee.firstName}},\n\n" +
      "Your {{leave.type}} from {{leave.from}} to {{leave.to}} was not approved.\n\n" +
      "Reason: {{leave.rejectionReason}}",
    actionUrl: "/me/leave",
  },
  leave_cancelled: {
    event: "leave.cancelled",
    channels: ["in_app"],
    subject: "Leave request cancelled",
    title: "Leave cancelled",
    body: "{{employee.name}} cancelled their {{leave.type}} from {{leave.from}} to {{leave.to}}.",
  },

  // ── Attendance ───────────────────────────────────────────────────────────
  attendance_late: {
    event: "attendance.late",
    channels: ["in_app"],
    subject: "You were marked late today",
    title: "Marked late",
    body:
      "You checked in at {{attendance.checkIn}} on {{attendance.date}}, which is {{attendance.lateBy}} " +
      "after your shift start of {{attendance.shiftStart}}.",
    actionUrl: "/me/attendance",
  },
  attendance_missing_punch: {
    event: "attendance.missing_punch",
    channels: ["in_app", "email"],
    subject: "A punch is missing for {{attendance.date}}",
    title: "Missing punch",
    body:
      "We recorded a check-in but no check-out for {{attendance.date}}. " +
      "Raise a regularization request so your attendance is correct.",
    actionUrl: "/me/attendance",
  },
  attendance_correction_requested: {
    event: "attendance.correction_requested",
    channels: ["in_app", "email"],
    subject: "Attendance correction from {{employee.name}}",
    title: "Attendance correction request",
    body: "{{employee.name}} has requested a correction for {{correction.date}}.\n\nReason: {{correction.reason}}",
    actionUrl: "/app/attendance/corrections",
  },
  attendance_correction_resolved: {
    event: "attendance.correction_resolved",
    channels: ["in_app"],
    subject: "Your attendance correction was {{correction.status}}",
    title: "Correction {{correction.status}}",
    body: "Your correction request for {{correction.date}} was {{correction.status}}.",
  },

  // ── Payroll ──────────────────────────────────────────────────────────────
  payslip_published: {
    event: "payroll.payslip_published",
    channels: ["in_app", "email"],
    subject: "Your payslip for {{period.label}} is ready",
    title: "Payslip available",
    body:
      "Hi {{employee.firstName}},\n\n" +
      "Your payslip for {{period.label}} is now available in your Chefotech HRMS portal.",
    actionUrl: "/me/payslips",
  },
  payroll_completed: {
    event: "payroll.completed",
    channels: ["in_app", "email"],
    subject: "Payroll for {{period.label}} has been processed",
    title: "Payroll processed",
    body:
      "Payroll for {{period.label}} finished: {{run.employeeCount}} employees, " +
      "net payable {{run.netTotal}}.",
    actionUrl: "/app/payroll",
  },

  // ── Documents and employees ──────────────────────────────────────────────
  document_expiring: {
    event: "document.expiring",
    channels: ["in_app", "email"],
    subject: "{{document.name}} expires in {{document.daysLeft}} days",
    title: "Document expiring",
    body:
      "{{document.name}} for {{employee.name}} expires on {{document.expiresOn}} " +
      "({{document.daysLeft}} days from now).",
    actionUrl: "/app/employees/{{employee.id}}",
  },
  employee_joined: {
    event: "employee.joined",
    channels: ["in_app"],
    subject: "{{employee.name}} joins today",
    title: "New joiner",
    body: "{{employee.name}} joins {{employee.department}} as {{employee.designation}} today.",
    actionUrl: "/app/employees/{{employee.id}}",
  },
  birthday_today: {
    event: "employee.birthday",
    channels: ["in_app"],
    subject: "Birthdays today",
    title: "Birthdays today",
    body: "{{names}} — wish them a happy birthday.",
  },

  // ── Workflow ─────────────────────────────────────────────────────────────
  approval_pending: {
    event: "workflow.approval_pending",
    channels: ["in_app", "email"],
    subject: "{{request.type}} awaiting your approval",
    title: "Approval needed",
    body: "{{request.requesterName}} raised a {{request.type}} that needs your approval.",
    actionUrl: "{{request.url}}",
  },
  approval_escalated: {
    event: "workflow.escalated",
    channels: ["in_app", "email"],
    subject: "An approval has been escalated to you",
    title: "Escalated approval",
    body:
      "A {{request.type}} from {{request.requesterName}} has been waiting for " +
      "{{request.pendingDays}} days and has been escalated to you.",
    actionUrl: "{{request.url}}",
  },

  announcement: {
    event: "announcement",
    channels: ["in_app", "email"],
    subject: "{{title}}",
    title: "{{title}}",
    body: "{{message}}",
  },
};

const TEMPLATE_KEYS = Object.keys(TEMPLATES);

/** Resolve {{a.b.c}} placeholders. Unknown paths render as an empty string. */
function render(text, data) {
  if (!text) return "";
  return String(text).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path) => {
    const value = path.split(".").reduce((acc, key) => {
      if (acc === null || acc === undefined) return undefined;
      return acc[key];
    }, data);
    return value === null || value === undefined ? "" : String(value);
  });
}

/** Every placeholder a template uses — powers the "available variables" hint. */
function variablesIn(template) {
  const found = new Set();
  for (const field of ["subject", "title", "body", "actionUrl"]) {
    const text = template[field];
    if (!text) continue;
    for (const m of String(text).matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) found.add(m[1]);
  }
  return [...found];
}

module.exports = { TEMPLATES, TEMPLATE_KEYS, render, variablesIn };
