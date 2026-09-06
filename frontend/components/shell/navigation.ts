import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  Clock,
  FileText,
  Fingerprint,
  GitBranch,
  LayoutDashboard,
  LifeBuoy,
  MessageSquareText,
  Receipt,
  Settings,
  ShieldCheck,
  Target,
  Users,
  Wallet,
} from "lucide-react";

/**
 * The navigation tree.
 *
 * Each item declares the permission (or plan feature) it needs, and the shell
 * filters the whole tree once. Nothing anywhere else asks "should this link
 * show" — which is why a custom role built by a tenant produces a sensible
 * sidebar without anyone updating a mapping table.
 */

export interface NavItem {
  label: string;
  href: string;
  icon?: LucideIcon;
  /** All of these permissions are required. */
  permission?: string | string[];
  /** Any one of these is enough. */
  anyPermission?: string[];
  feature?: string;
  children?: NavItem[];
  badgeKey?: "pendingApprovals";
  exact?: boolean;
}

export interface NavSection {
  label?: string;
  items: NavItem[];
}

export const APP_NAVIGATION: NavSection[] = [
  {
    items: [
      { label: "Dashboard", href: "/app", icon: LayoutDashboard, exact: true },
      {
        label: "Approvals",
        href: "/app/approvals",
        icon: ClipboardCheck,
        anyPermission: ["workflow.act", "leave.approve", "attendance.approve"],
        badgeKey: "pendingApprovals",
      },
    ],
  },
  {
    label: "People",
    items: [
      {
        label: "Employees",
        href: "/app/employees",
        icon: Users,
        anyPermission: ["employee.view", "attendance.view_team"],
      },
      {
        label: "Onboarding",
        href: "/app/onboarding",
        icon: ClipboardCheck,
        anyPermission: ["onboarding.view", "onboarding.manage"],
      },
      {
        label: "Exits",
        href: "/app/exits",
        icon: ClipboardCheck,
        anyPermission: ["exit.view", "exit.manage"],
      },
      {
        label: "Performance",
        href: "/app/performance",
        icon: Target,
        anyPermission: ["performance.review", "performance.manage"],
      },
      { label: "Surveys", href: "/app/surveys", icon: MessageSquareText, permission: "survey.manage" },
      {
        label: "Organization",
        href: "/app/organization",
        icon: Building2,
        anyPermission: ["department.view", "designation.view", "location.view"],
        children: [
          { label: "Departments", href: "/app/organization/departments", permission: "department.view" },
          { label: "Designations", href: "/app/organization/designations", permission: "designation.view" },
          { label: "Locations", href: "/app/organization/locations", permission: "location.view" },
          { label: "Org chart", href: "/app/organization/chart", permission: "employee.view" },
        ],
      },
    ],
  },
  {
    label: "Time",
    items: [
      {
        label: "Attendance",
        href: "/app/attendance",
        icon: Clock,
        anyPermission: ["attendance.view", "attendance.view_team"],
        children: [
          { label: "Daily", href: "/app/attendance", exact: true },
          { label: "Monthly", href: "/app/attendance/monthly" },
          { label: "Corrections", href: "/app/attendance/corrections" },
          { label: "Overtime", href: "/app/attendance/overtime", permission: "attendance.approve" },
        ],
      },
      {
        label: "Leave",
        href: "/app/leave",
        icon: CalendarDays,
        anyPermission: ["leave.view", "leave.view_team"],
        children: [
          { label: "Requests", href: "/app/leave", exact: true },
          { label: "Calendar", href: "/app/leave/calendar" },
          { label: "Balances", href: "/app/leave/balances", permission: "leave.view" },
        ],
      },
      {
        label: "Shifts",
        href: "/app/shifts",
        icon: CalendarRange,
        permission: "shift.view",
      },
      {
        label: "Biometric",
        href: "/app/biometric",
        icon: Fingerprint,
        permission: "biometric.view",
        feature: "biometric",
      },
    ],
  },
  {
    label: "Money",
    items: [
      {
        label: "Payroll",
        href: "/app/payroll",
        icon: Wallet,
        permission: "payroll.view",
        feature: "payroll",
        children: [
          { label: "Runs", href: "/app/payroll", exact: true },
          { label: "Salary structures", href: "/app/payroll/structures", permission: "payroll.manage_structures" },
          { label: "Components", href: "/app/payroll/components", permission: "payroll.manage_components" },
        ],
      },
    ],
  },
  {
    label: "Records",
    items: [
      {
        label: "Documents",
        href: "/app/documents",
        icon: FileText,
        anyPermission: ["document.view", "document.generate", "document.manage_templates", "document.manage_company", "report.view"],
      },
      {
        label: "Requests",
        href: "/app/requests",
        icon: ClipboardCheck,
        anyPermission: ["request.approve", "request.view"],
      },
      {
        label: "Expenses",
        href: "/app/expenses",
        icon: Receipt,
        anyPermission: ["expense.approve", "expense.view", "expense.reimburse"],
      },
      {
        label: "Loans",
        href: "/app/loans",
        icon: Wallet,
        anyPermission: ["loan.manage", "loan.approve"],
      },
      { label: "Assets", href: "/app/assets", icon: Building2, permission: "asset.view" },
      { label: "Help desk", href: "/app/tickets", icon: LifeBuoy, permission: "ticket.manage" },
      { label: "Reports", href: "/app/reports", icon: BarChart3, permission: "report.view" },
      {
        label: "Workflows",
        href: "/app/workflows",
        icon: GitBranch,
        permission: "workflow.manage",
        feature: "workflows",
      },
      { label: "Audit trail", href: "/app/audit", icon: ShieldCheck, permission: "audit.view" },
    ],
  },
  {
    items: [
      {
        label: "Settings",
        href: "/app/settings",
        icon: Settings,
        anyPermission: ["settings.view", "settings.manage", "role.view", "user.view"],
      },
      // No permission gate: everyone who can reach the app can read the
      // documentation for the parts of it they can reach.
      {
        label: "Help",
        href: "/app/help",
        icon: LifeBuoy,
      },
    ],
  },
];

export const SETTINGS_NAVIGATION: NavItem[] = [
  { label: "Organization", href: "/app/settings", permission: "settings.view", exact: true },
  { label: "Branding", href: "/app/settings/branding", permission: "settings.manage_branding" },
  { label: "Users", href: "/app/settings/users", permission: "user.view" },
  { label: "Roles & permissions", href: "/app/settings/roles", permission: "role.view" },
  { label: "Employee fields", href: "/app/settings/employee-fields", permission: "employee.manage_custom_fields" },
  { label: "Attendance policies", href: "/app/settings/attendance", permission: "settings.manage_policies" },
  // Was labelled "Shifts & week off" while no week-off screen existed — the
  // entity had a backend and a resolver but nothing to reach it with.
  { label: "Shifts", href: "/app/settings/shifts", permission: "shift.manage" },
  { label: "Week off patterns", href: "/app/settings/week-off", permission: "shift.manage" },
  { label: "Shift patterns", href: "/app/settings/shift-patterns", permission: "shift.manage" },
  { label: "Holidays", href: "/app/settings/holidays", permission: "holiday.manage" },
  { label: "Leave types", href: "/app/settings/leave-types", permission: "leave.manage_types" },
  { label: "Leave policies", href: "/app/settings/leave", permission: "leave.manage_policies" },
  { label: "Payroll", href: "/app/settings/payroll", permission: "payroll.manage_components", feature: "payroll" },
  { label: "Biometric devices", href: "/app/settings/biometric", permission: "biometric.manage", feature: "biometric" },
  { label: "Document templates", href: "/app/settings/documents", permission: "document.manage_templates" },
  {
    label: "Notifications",
    href: "/app/settings/notifications",
    anyPermission: ["notification.manage_templates", "notification.broadcast"],
  },
  {
    label: "Email delivery",
    href: "/app/settings/mail",
    anyPermission: ["notification.manage_templates", "notification.view_mail_log"],
  },
  { label: "Security", href: "/app/settings/security", permission: "settings.manage_security" },
  { label: "API & webhooks", href: "/app/settings/integrations", permission: "settings.manage_integrations" },
  { label: "AI assistant", href: "/app/settings/ai", permission: "settings.manage_ai" },
  { label: "Plan & usage", href: "/app/settings/plan", permission: "settings.view" },
];

export const PORTAL_NAVIGATION: NavItem[] = [
  { label: "Home", href: "/me", icon: LayoutDashboard, exact: true },
  { label: "Getting started", href: "/me/onboarding", icon: ClipboardCheck, permission: "onboarding.view" },
  { label: "People", href: "/me/directory", icon: Users, permission: "directory.view" },
  { label: "My attendance", href: "/me/attendance", icon: Clock },
  { label: "My leave", href: "/me/leave", icon: CalendarDays },
  { label: "Holidays", href: "/me/holidays", icon: CalendarRange, permission: "holiday.view" },
  { label: "My payslips", href: "/me/payslips", icon: Wallet, permission: "payroll.view_own_payslip" },
  { label: "My requests", href: "/me/requests", icon: ClipboardCheck, permission: "request.submit" },
  { label: "My performance", href: "/me/performance", icon: Target, permission: "performance.view_own" },
  { label: "Surveys", href: "/me/surveys", icon: MessageSquareText, permission: "survey.respond" },
  { label: "My expenses", href: "/me/expenses", icon: Receipt, anyPermission: ["expense.submit", "expense.view_own"] },
  { label: "Loans", href: "/me/loans", icon: Wallet, permission: "loan.view_own" },
  { label: "My assets", href: "/me/assets", icon: Building2, anyPermission: ["asset.view_own", "asset.view"] },
  { label: "Help desk", href: "/me/tickets", icon: LifeBuoy, anyPermission: ["ticket.create", "ticket.view_own"] },
  { label: "My documents", href: "/me/documents", icon: FileText },
  { label: "Notifications", href: "/me/notifications", icon: Bell },
  { label: "My profile", href: "/me/profile", icon: Users },
  { label: "Security", href: "/me/security", icon: ShieldCheck },
];

interface FilterContext {
  can: (...permissions: string[]) => boolean;
  canAny: (...permissions: string[]) => boolean;
  hasFeature: (feature: string) => boolean;
}

function isVisible(item: NavItem, context: FilterContext) {
  if (item.feature && !context.hasFeature(item.feature)) return false;

  if (item.permission) {
    const required = Array.isArray(item.permission) ? item.permission : [item.permission];
    if (!context.can(...required)) return false;
  }

  if (item.anyPermission && !context.canAny(...item.anyPermission)) return false;

  return true;
}

export function filterNavigation(sections: NavSection[], context: FilterContext): NavSection[] {
  return sections
    .map((section) => ({
      ...section,
      items: section.items
        .filter((item) => isVisible(item, context))
        .map((item) => ({
          ...item,
          children: item.children?.filter((child) => isVisible(child, context)),
        })),
    }))
    .filter((section) => section.items.length > 0);
}

export function filterNavItems(items: NavItem[], context: FilterContext) {
  return items.filter((item) => isVisible(item, context));
}

/** Whether a nav link should render as the current page. */
export function isActivePath(pathname: string, item: NavItem) {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
