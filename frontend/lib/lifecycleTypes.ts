import type { EmployeeRef } from "@/lib/moduleTypes";

export interface LifecycleTask {
  id: string;
  title: string;
  description: string;
  owner: "hr" | "it" | "finance" | "admin" | "manager" | "employee";
  assignee: string | null;
  assigneeUserId: string | null;
  status: "pending" | "done" | "skipped";
  completedAt: string | null;
  completedBy: string | null;
  note: string;
  dueOn?: string | null;
  isOverdue?: boolean;
  recoveryAmount?: number;
  autoComplete?: string;
}

export interface LifecycleEmployee extends EmployeeRef {
  designation?: string | null;
  joiningDate?: string | null;
  status?: string;
  hasPortalAccount?: boolean;
}

export interface Progress {
  done: number;
  total: number;
  percent: number;
  overdue?: number;
}

export interface SettlementLine {
  label: string;
  detail?: string;
  amount: number;
}

export interface EmployeeExit {
  id: string;
  employee: LifecycleEmployee;
  type: "resignation" | "termination" | "retirement" | "end_of_contract" | "absconded";
  reason: string;
  proposedLastDay: string | null;
  lastWorkingDay: string | null;
  resignationDate: string | null;
  noticePeriodDays: number | null;
  noticeWaived: boolean;
  noticeShortfallDays: number;
  isRehirable?: boolean;
  status: "requested" | "accepted" | "in_progress" | "completed" | "rejected" | "withdrawn" | "cancelled";
  initiatedBy: "employee" | "hr";
  decidedBy: string | null;
  decidedAt: string | null;
  decisionComment: string;
  tasks: LifecycleTask[];
  progress: Progress;
  exitInterviewNotes?: string;
  settlement: { computedAt: string; dues: SettlementLine[]; recoveries: SettlementLine[]; totalDues: number; totalRecoveries: number; net: number; settledAt: string | null; documentId: string | null } | null;
  completedAt: string | null;
  createdAt: string;
}

export interface Onboarding {
  id: string;
  employee: LifecycleEmployee;
  templateName: string;
  joiningDate: string | null;
  buddy: LifecycleEmployee | null;
  welcomeNote: string;
  tasks: LifecycleTask[];
  progress: Progress;
  status: "in_progress" | "completed" | "cancelled";
  completedAt: string | null;
  createdAt: string;
}

export interface OnboardingTemplate {
  id: string;
  name: string;
  description: string;
  appliesTo: { departmentIds: string[]; employmentTypes: string[] };
  tasks: Array<{ id?: string; title: string; description: string; owner: LifecycleTask["owner"]; dueOffsetDays: number; autoComplete: string }>;
  isDefault: boolean;
  isActive: boolean;
}

export interface MyTask {
  onboardingId?: string;
  exitId?: string;
  taskId: string;
  title: string;
  owner: string;
  dueOn?: string | null;
  isOverdue?: boolean;
  lastWorkingDay?: string | null;
  employee: LifecycleEmployee;
}

export interface EmployeeChange {
  id: string;
  employee: EmployeeRef;
  type: string;
  effectiveDate: string;
  changes: Record<string, unknown>;
  previous: Record<string, unknown> | null;
  reason: string;
  letterTemplateCode: string | null;
  letterDocumentId: string | null;
  salaryRevision: { ctcAnnual: number } | null;
  status: "scheduled" | "applied" | "cancelled" | "failed";
  appliedAt: string | null;
  error: string | null;
  recordedBy: string | null;
  createdAt: string;
}

export interface DirectoryEntry {
  id: string;
  employeeCode: string;
  name: string;
  firstName: string;
  workEmail: string | null;
  phone: string | null;
  department: string | null;
  designation: string | null;
  location: string | null;
  manager: { id: string; name: string } | null;
  joiningDate: string | null;
  birthday: string | null;
  avatarUrl: string | null;
  skills: string[];
}

export const OWNER_LABELS: Record<string, string> = { hr: "HR", it: "IT", finance: "Finance", admin: "Admin", manager: "Manager", employee: "Employee" };
