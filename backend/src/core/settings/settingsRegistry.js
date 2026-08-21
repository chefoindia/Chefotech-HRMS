"use strict";

/**
 * The settings registry.
 *
 * Every configurable value in the platform is declared here once, with its
 * type, default, validation and the permission required to change it. Nothing
 * reads a magic number from a service file, and no module invents its own
 * config storage.
 *
 * Adding a setting means adding a row here — the settings API, the settings UI
 * and the validation all derive from this list, so there is no second place to
 * update and no way for the three to drift apart.
 */

const SETTING_TYPES = [
  "boolean",
  "string",
  "number",
  "date",
  "time",
  "enum",
  "multienum",
  "json",
  "formula",
  "reference",
  "array",
  "color",
];

const define = (rows) => rows;

const SETTINGS = define([
  // ── Organization ─────────────────────────────────────────────────────────
  {
    key: "org.week_start_day",
    group: "organization",
    label: "Week starts on",
    type: "enum",
    options: [
      { value: 0, label: "Sunday" },
      { value: 1, label: "Monday" },
    ],
    default: 1,
    description: "Used by calendars, weekly reports and roster views.",
  },
  {
    key: "org.financial_year_start_month",
    group: "organization",
    label: "Financial year starts in",
    type: "enum",
    options: Array.from({ length: 12 }, (_, i) => ({
      value: i + 1,
      label: new Date(2000, i, 1).toLocaleString("en", { month: "long" }),
    })),
    default: 4,
    description: "Drives payroll periods, leave-year boundaries and reports.",
  },
  {
    key: "org.date_format",
    group: "organization",
    label: "Date format",
    type: "enum",
    options: [
      { value: "DD/MM/YYYY", label: "31/12/2026" },
      { value: "MM/DD/YYYY", label: "12/31/2026" },
      { value: "YYYY-MM-DD", label: "2026-12-31" },
      { value: "DD MMM YYYY", label: "31 Dec 2026" },
    ],
    default: "DD MMM YYYY",
  },
  {
    key: "org.time_format",
    group: "organization",
    label: "Time format",
    type: "enum",
    options: [
      { value: "12h", label: "05:30 PM" },
      { value: "24h", label: "17:30" },
    ],
    default: "12h",
  },

  // ── Employees ────────────────────────────────────────────────────────────
  {
    key: "employee.code_prefix",
    group: "employee",
    label: "Employee code prefix",
    type: "string",
    default: "EMP",
    validation: { maxLength: 10, pattern: "^[A-Za-z0-9-]*$" },
    description: "Prefix for auto-generated employee codes.",
  },
  {
    key: "employee.code_padding",
    group: "employee",
    label: "Employee code number length",
    type: "number",
    default: 4,
    validation: { min: 1, max: 10 },
    description: "EMP0001 with a length of 4.",
  },
  {
    key: "employee.code_next_number",
    group: "employee",
    label: "Next employee number",
    type: "number",
    default: 1,
    validation: { min: 1 },
  },
  {
    key: "employee.code_auto_generate",
    group: "employee",
    label: "Generate employee codes automatically",
    type: "boolean",
    default: true,
  },
  {
    key: "employee.probation_months",
    group: "employee",
    label: "Default probation period (months)",
    type: "number",
    default: 3,
    validation: { min: 0, max: 24 },
  },
  {
    key: "employee.notice_period_days",
    group: "employee",
    label: "Default notice period (days)",
    type: "number",
    default: 30,
    validation: { min: 0, max: 365 },
  },
  {
    key: "employee.self_editable_fields",
    group: "employee",
    label: "Fields an employee may edit themselves",
    type: "multienum",
    options: [
      { value: "personal.phone", label: "Phone" },
      { value: "personal.personalEmail", label: "Personal email" },
      { value: "personal.currentAddress", label: "Current address" },
      { value: "personal.emergencyContacts", label: "Emergency contacts" },
      { value: "personal.maritalStatus", label: "Marital status" },
      { value: "bank", label: "Bank details" },
      { value: "avatar", label: "Profile photo" },
    ],
    default: [
      "personal.phone",
      "personal.personalEmail",
      "personal.currentAddress",
      "personal.emergencyContacts",
      "avatar",
    ],
    description: "Anything not listed is read-only in the employee portal.",
  },

  // ── Attendance ───────────────────────────────────────────────────────────
  {
    key: "attendance.capture_mode",
    group: "attendance",
    label: "How attendance is captured",
    type: "multienum",
    options: [
      { value: "biometric", label: "Biometric device" },
      { value: "web", label: "Web check-in" },
      { value: "mobile", label: "Mobile check-in" },
      { value: "manual", label: "Manual entry by HR" },
    ],
    default: ["biometric", "web", "manual"],
  },
  {
    key: "attendance.first_last_punch_only",
    group: "attendance",
    label: "Use only the first and last punch of the day",
    type: "boolean",
    default: true,
    description:
      "When off, every in/out pair is treated as a work session and break time is deducted.",
  },
  {
    key: "attendance.allow_future_dated_correction",
    group: "attendance",
    label: "Allow corrections for future dates",
    type: "boolean",
    default: false,
  },
  {
    key: "attendance.correction_window_days",
    group: "attendance",
    label: "Correction window (days)",
    type: "number",
    default: 7,
    validation: { min: 0, max: 90 },
    description: "How far back an employee may raise a regularization request.",
  },
  {
    key: "attendance.auto_lock_after_days",
    group: "attendance",
    label: "Auto-lock attendance after (days)",
    type: "number",
    default: 0,
    validation: { min: 0, max: 120 },
    description: "0 disables automatic locking.",
  },
  {
    key: "attendance.geofence_enabled",
    group: "attendance",
    label: "Restrict web check-in to work locations",
    type: "boolean",
    default: false,
  },
  {
    key: "attendance.geofence_radius_metres",
    group: "attendance",
    label: "Geofence radius (metres)",
    type: "number",
    default: 200,
    validation: { min: 20, max: 5000 },
    dependsOn: { key: "attendance.geofence_enabled", equals: true },
  },

  // ── Leave ────────────────────────────────────────────────────────────────
  {
    key: "leave.year_start_month",
    group: "leave",
    label: "Leave year starts in",
    type: "enum",
    options: Array.from({ length: 12 }, (_, i) => ({
      value: i + 1,
      label: new Date(2000, i, 1).toLocaleString("en", { month: "long" }),
    })),
    default: 1,
  },
  {
    key: "leave.allow_negative_balance",
    group: "leave",
    label: "Allow leave balances to go negative",
    type: "boolean",
    default: false,
  },
  {
    key: "leave.max_negative_days",
    group: "leave",
    label: "Maximum negative balance (days)",
    type: "number",
    default: 0,
    validation: { min: 0, max: 30 },
    dependsOn: { key: "leave.allow_negative_balance", equals: true },
  },
  {
    key: "leave.allow_backdated_application",
    group: "leave",
    label: "Allow backdated leave applications",
    type: "boolean",
    default: true,
  },
  {
    key: "leave.backdated_limit_days",
    group: "leave",
    label: "Backdated application limit (days)",
    type: "number",
    default: 30,
    validation: { min: 0, max: 365 },
  },
  {
    key: "leave.auto_approve_on_no_action_days",
    group: "leave",
    label: "Auto-approve after no action for (days)",
    type: "number",
    default: 0,
    validation: { min: 0, max: 60 },
    description: "0 disables auto-approval.",
  },

  // ── Payroll ──────────────────────────────────────────────────────────────
  {
    key: "payroll.cycle_start_day",
    group: "payroll",
    label: "Payroll cycle starts on day",
    type: "number",
    default: 1,
    validation: { min: 1, max: 28 },
    description: "Use 26 for a 26th-to-25th cycle.",
  },
  {
    key: "payroll.pay_day",
    group: "payroll",
    label: "Salary credited on day",
    type: "number",
    default: 1,
    validation: { min: 1, max: 31 },
  },
  {
    key: "payroll.working_days_basis",
    group: "payroll",
    label: "Per-day salary is calculated on",
    type: "enum",
    options: [
      { value: "calendar_days", label: "Calendar days in the month" },
      { value: "working_days", label: "Working days in the month" },
      { value: "fixed_days", label: "A fixed number of days" },
    ],
    default: "calendar_days",
    description: "This single choice changes every loss-of-pay deduction.",
  },
  {
    key: "payroll.fixed_days_in_month",
    group: "payroll",
    label: "Fixed days in a month",
    type: "number",
    default: 30,
    validation: { min: 26, max: 31 },
    dependsOn: { key: "payroll.working_days_basis", equals: "fixed_days" },
  },
  {
    key: "payroll.rounding",
    group: "payroll",
    label: "Round payslip amounts to",
    type: "enum",
    options: [
      { value: "none", label: "No rounding (2 decimals)" },
      { value: "nearest_1", label: "Nearest 1" },
      { value: "nearest_10", label: "Nearest 10" },
    ],
    default: "nearest_1",
  },
  {
    key: "payroll.lop_from_attendance",
    group: "payroll",
    label: "Deduct loss of pay from attendance automatically",
    type: "boolean",
    default: true,
  },
  {
    key: "payroll.payslip_publish_requires_approval",
    group: "payroll",
    label: "Payslips can only be published after approval",
    type: "boolean",
    default: true,
  },

  // ── Notifications ────────────────────────────────────────────────────────
  {
    key: "notification.channels_enabled",
    group: "notification",
    label: "Enabled notification channels",
    type: "multienum",
    options: [
      { value: "in_app", label: "In-app" },
      { value: "email", label: "Email" },
      { value: "push", label: "Push" },
      { value: "sms", label: "SMS" },
    ],
    default: ["in_app", "email"],
  },
  {
    key: "notification.daily_digest_time",
    group: "notification",
    label: "Daily digest time",
    type: "time",
    default: "09:00",
  },
  {
    key: "notification.notify_on_late",
    group: "notification",
    label: "Notify employees when they are marked late",
    type: "boolean",
    default: true,
  },
  {
    key: "notification.document_expiry_reminder_days",
    group: "notification",
    label: "Remind before document expiry (days)",
    type: "array",
    default: [30, 7, 1],
    description: "A reminder is sent this many days before a document expires.",
  },

  // ── Security ─────────────────────────────────────────────────────────────
  {
    key: "security.session_idle_minutes",
    group: "security",
    label: "Sign out after inactivity (minutes)",
    type: "number",
    default: 480,
    validation: { min: 15, max: 10080 },
  },
  {
    key: "security.password_min_length",
    group: "security",
    label: "Minimum password length",
    type: "number",
    default: 10,
    validation: { min: 8, max: 64 },
  },
  {
    key: "security.password_expiry_days",
    group: "security",
    label: "Force password change every (days)",
    type: "number",
    default: 0,
    validation: { min: 0, max: 365 },
    description: "0 disables password expiry.",
  },
  {
    key: "security.enforce_two_factor",
    group: "security",
    label: "Require two-factor authentication for admins",
    type: "boolean",
    default: false,
  },
  {
    key: "security.allowed_ip_ranges",
    group: "security",
    label: "Restrict access to IP ranges",
    type: "array",
    default: [],
    description: "Leave empty to allow access from anywhere.",
  },

  // ── Help ─────────────────────────────────────────────────────────────────
  {
    key: "help.tours_enabled",
    group: "help",
    label: "Show guided tours",
    type: "boolean",
    default: true,
  },
  {
    key: "help.assistant_enabled",
    group: "help",
    label: "Show the guided help assistant",
    type: "boolean",
    default: true,
  },
]);

const SETTINGS_BY_KEY = Object.fromEntries(SETTINGS.map((s) => [s.key, s]));

const SETTING_GROUPS = [
  { key: "organization", label: "Organization", permission: "settings.manage" },
  { key: "employee", label: "Employees", permission: "settings.manage" },
  { key: "attendance", label: "Attendance", permission: "settings.manage_policies" },
  { key: "leave", label: "Leave", permission: "settings.manage_policies" },
  { key: "payroll", label: "Payroll", permission: "settings.manage_policies" },
  { key: "notification", label: "Notifications", permission: "settings.manage" },
  { key: "security", label: "Security", permission: "settings.manage_security" },
  { key: "help", label: "Help", permission: "settings.manage" },
];

function defaults() {
  return Object.fromEntries(SETTINGS.map((s) => [s.key, s.default]));
}

function definitionOf(key) {
  return SETTINGS_BY_KEY[key] || null;
}

module.exports = {
  SETTINGS,
  SETTINGS_BY_KEY,
  SETTING_GROUPS,
  SETTING_TYPES,
  defaults,
  definitionOf,
};
