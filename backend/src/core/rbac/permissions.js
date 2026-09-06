"use strict";

/**
 * The permission catalog.
 *
 * Permissions are data, not code: they are seeded into every organization and
 * attached to roles that tenant admins can edit. Adding a capability means
 * adding an entry here and referencing it in a route guard — never writing
 * `if (user.role === "HR_ADMIN")` in a controller or a React component.
 *
 * Naming: `<domain>.<action>` in lower snake segments. `*.manage` implies the
 * full CRUD surface for that domain and is what most admin roles get.
 */

const PERMISSION_GROUPS = [
  {
    key: "dashboard",
    label: "Dashboard",
    permissions: [
      ["dashboard.view", "View the HR dashboard"],
      ["dashboard.view_org_wide", "See organization-wide figures, not just own team"],
    ],
  },
  {
    key: "employee",
    label: "Employees",
    permissions: [
      ["employee.view", "View employee records"],
      ["employee.view_sensitive", "View bank, identity and salary details"],
      ["employee.create", "Add employees"],
      ["employee.update", "Edit employee records"],
      ["employee.delete", "Archive employees"],
      ["employee.import", "Bulk import employees"],
      ["employee.export", "Export employee data"],
      ["employee.manage_custom_fields", "Define custom employee fields"],
    ],
  },
  {
    key: "org_structure",
    label: "Organization structure",
    permissions: [
      ["department.view", "View departments"],
      ["department.manage", "Create and edit departments"],
      ["designation.view", "View designations"],
      ["designation.manage", "Create and edit designations"],
      ["location.view", "View work locations"],
      ["location.manage", "Create and edit work locations"],
    ],
  },
  {
    key: "attendance",
    label: "Attendance",
    permissions: [
      ["attendance.view", "View attendance records"],
      ["attendance.view_team", "View the attendance of direct reports"],
      ["attendance.view_own", "View own attendance"],
      ["attendance.manage", "Edit attendance records"],
      ["attendance.correct", "Raise attendance corrections"],
      ["attendance.approve", "Approve attendance corrections"],
      ["attendance.lock", "Lock an attendance period"],
      ["attendance.export", "Export attendance data"],
      ["attendance.punch", "Record own punches"],
    ],
  },
  {
    key: "shift",
    label: "Shifts",
    permissions: [
      ["shift.view", "View shifts"],
      ["shift.manage", "Create and edit shifts"],
      ["shift.assign", "Assign shifts to employees"],
    ],
  },
  {
    key: "holiday",
    label: "Holidays",
    permissions: [
      ["holiday.view", "View holiday calendars"],
      ["holiday.manage", "Create and edit holiday calendars"],
    ],
  },
  {
    key: "leave",
    label: "Leave",
    permissions: [
      ["leave.view", "View leave records"],
      ["leave.view_team", "View the leave of direct reports"],
      ["leave.apply", "Apply for leave"],
      ["leave.apply_on_behalf", "Apply for leave on behalf of an employee"],
      ["leave.approve", "Approve leave requests"],
      ["leave.reject", "Reject leave requests"],
      ["leave.cancel_any", "Cancel any leave request"],
      ["leave.manage_types", "Create and edit leave types"],
      ["leave.manage_policies", "Create and edit leave policies"],
      ["leave.adjust_balance", "Manually adjust leave balances"],
      ["leave.export", "Export leave data"],
    ],
  },
  {
    key: "payroll",
    label: "Payroll",
    permissions: [
      ["payroll.view", "View payroll runs"],
      ["payroll.view_own_payslip", "View own payslips"],
      ["payroll.manage_components", "Define salary components"],
      ["payroll.manage_structures", "Define salary structures"],
      ["payroll.assign_salary", "Assign salary to employees"],
      ["payroll.process", "Run payroll"],
      ["payroll.approve", "Approve a payroll run"],
      ["payroll.lock", "Lock a payroll run"],
      ["payroll.publish_payslips", "Publish payslips to employees"],
      ["payroll.export", "Export payroll data"],
    ],
  },
  {
    key: "document",
    label: "Documents",
    permissions: [
      ["document.view", "View employee documents"],
      ["document.view_own", "View own documents"],
      ["document.upload", "Upload documents"],
      ["document.delete", "Delete documents"],
      ["document.manage_templates", "Create and edit document templates"],
      ["document.generate", "Generate documents from templates"],
      ["document.manage_company", "Publish company policies and handbooks", 2],
    ],
  },
  {
    key: "workflow",
    label: "Workflows",
    permissions: [
      ["workflow.view", "View approval workflows"],
      ["workflow.manage", "Create and edit approval workflows"],
      ["workflow.act", "Act on assigned approvals"],
      ["workflow.delegate", "Delegate approvals"],
    ],
  },
  {
    key: "report",
    label: "Reports",
    permissions: [
      ["report.view", "Run reports"],
      ["report.export", "Export reports"],
      ["report.manage_definitions", "Create and edit report definitions"],
    ],
  },
  {
    key: "biometric",
    label: "Biometric devices",
    permissions: [
      ["biometric.view", "View devices and sync logs"],
      ["biometric.manage", "Add and configure devices"],
      ["biometric.sync", "Trigger a device sync"],
      ["biometric.reprocess", "Reprocess raw punch events"],
    ],
  },
  {
    key: "settings",
    label: "Settings",
    permissions: [
      ["settings.view", "View organization settings"],
      ["settings.manage", "Change organization settings"],
      ["settings.manage_branding", "Change branding and theme"],
      ["settings.manage_policies", "Change attendance and leave policies"],
      ["settings.manage_integrations", "Manage integrations and webhooks"],
      ["settings.manage_security", "Change security settings"],
      ["settings.manage_ai", "Configure the organization's AI provider key"],
    ],
  },
  {
    key: "users",
    label: "Users and roles",
    permissions: [
      ["user.view", "View platform users"],
      ["user.invite", "Invite users"],
      ["user.update", "Edit users"],
      ["user.deactivate", "Deactivate users"],
      ["role.view", "View roles"],
      ["role.manage", "Create and edit roles"],
      ["role.assign", "Assign roles to users"],
    ],
  },
  {
    key: "audit",
    label: "Audit",
    permissions: [
      ["audit.view", "View the audit trail"],
      ["audit.export", "Export the audit trail"],
    ],
  },
  {
    key: "notification",
    label: "Notifications",
    permissions: [
      ["notification.manage_templates", "Edit notification and email templates"],
      ["notification.broadcast", "Send announcements"],
      ["notification.view_mail_log", "View the outbound email log and delivery status", 2],
    ],
  },
  {
    key: "self_service",
    label: "Self service",
    permissions: [
      ["profile.view_own", "View own profile"],
      ["profile.update_own", "Update own profile"],
      ["expense.submit", "Submit expenses"],
      ["expense.view_own", "View own expenses"],
      ["expense.approve", "Approve expenses"],
      ["asset.view", "View assets"],
      ["asset.manage", "Assign and manage assets"],
      ["asset.view_own", "See the assets assigned to me", 3],
      ["request.submit", "Submit requests (work from home, comp-off, encashment, letters)", 3],
      ["request.approve", "Approve employee requests", 3],
      ["request.view", "View every employee request", 3],
      ["directory.view", "Browse the employee directory", 3],
    ],
  },
  {
    key: "helpdesk",
    label: "Help desk",
    permissions: [
      ["ticket.create", "Raise help desk tickets", 3],
      ["ticket.view_own", "View own tickets", 3],
      ["ticket.manage", "Work the help desk queue as an agent", 3],
    ],
  },
  {
    key: "finance",
    label: "Expenses and loans",
    permissions: [
      ["expense.view", "View every expense claim", 3],
      ["expense.reimburse", "Mark claims as reimbursed and send them to payroll", 3],
      ["loan.view_own", "View own loans and request one", 3],
      ["loan.approve", "Approve loan and advance requests", 3],
      ["loan.manage", "Record, disburse and close loans", 3],
    ],
  },
  {
    key: "lifecycle",
    label: "Onboarding and exits",
    permissions: [
      ["onboarding.view", "View onboarding checklists and own tasks", 3],
      ["onboarding.manage", "Design checklists and run onboarding", 3],
      ["exit.view", "View exits and clearances", 3],
      ["exit.manage", "Process resignations, clearances and settlements", 3],
    ],
  },
  {
    key: "engagement",
    label: "Surveys and performance",
    permissions: [
      ["survey.respond", "Answer surveys", 3],
      ["survey.manage", "Create surveys and see results", 3],
      ["performance.view_own", "See own goals and reviews", 3],
      ["performance.review", "Review direct reports", 3],
      ["performance.manage", "Run review cycles and see every review", 3],
    ],
  },
];

/**
 * The catalog version.
 *
 * Roles store permissions as an expanded list, frozen at the moment the role
 * was seeded or last edited. A permission added to this file later is
 * therefore absent from every existing organization's HR Admin role, even
 * though the template says `notification.*`. Each new permission carries the
 * version it arrived in (the optional third element of its tuple); on boot,
 * `rbac.service.syncSystemRolePermissions` grants system roles whatever their
 * template would have given them since the version they were last synced at.
 * Bump this whenever a permission is added.
 */
const PERMISSION_VERSION = 3;

/** Flat list: ["employee.view", "employee.create", ...] */
const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((g) =>
  g.permissions.map(([key]) => key)
);

const PERMISSION_META = Object.fromEntries(
  PERMISSION_GROUPS.flatMap((g) =>
    g.permissions.map(([key, description, version]) => [
      key,
      { key, description, group: g.key, groupLabel: g.label, version: version || 1 },
    ])
  )
);

/** Permissions introduced after a given catalog version. */
function permissionsAddedAfter(version) {
  return ALL_PERMISSIONS.filter((key) => PERMISSION_META[key].version > (version || 1));
}

function isValidPermission(key) {
  return Object.prototype.hasOwnProperty.call(PERMISSION_META, key);
}

/**
 * Expand wildcards. "employee.*" -> every employee permission, "*" -> all.
 * Roles are stored expanded, but definitions stay readable.
 */
function expandPermissions(patterns = []) {
  const out = new Set();
  for (const pattern of patterns) {
    if (pattern === "*") return [...ALL_PERMISSIONS];
    if (pattern.endsWith(".*")) {
      const prefix = pattern.slice(0, -1); // keep the dot
      for (const p of ALL_PERMISSIONS) if (p.startsWith(prefix)) out.add(p);
    } else if (isValidPermission(pattern)) {
      out.add(pattern);
    }
  }
  return [...out];
}

module.exports = {
  PERMISSION_GROUPS,
  ALL_PERMISSIONS,
  PERMISSION_META,
  PERMISSION_VERSION,
  isValidPermission,
  expandPermissions,
  permissionsAddedAfter,
};
