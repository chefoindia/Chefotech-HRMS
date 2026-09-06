/**
 * Types for the employee-facing modules: requests, help desk, expenses,
 * assets, loans and payroll inputs. Mirrors the shape() functions in the
 * corresponding backend services.
 */

export interface EmployeeRef {
  id: string;
  employeeCode?: string;
  name?: string;
  department?: string | null;
}

// ── Requests ────────────────────────────────────────────────────────────────

export const REQUEST_TYPES = ["wfh", "comp_off", "encashment", "shift_swap", "letter", "profile_change", "advance", "other"] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

export interface RequestTypeInfo {
  key: RequestType;
  label: string;
  description: string;
  approver: "manager" | "hr";
}

export interface EmployeeRequest {
  id: string;
  type: RequestType;
  typeLabel: string;
  payload: Record<string, unknown>;
  reason: string;
  summary: string;
  status: "pending" | "approved" | "rejected" | "cancelled" | "completed";
  attachmentFileId: string | null;
  employee: EmployeeRef;
  approverUserIds: string[];
  viaWorkflow: boolean;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionComment: string;
  effect: Record<string, unknown> | null;
  createdAt: string;
}

// ── Help desk ───────────────────────────────────────────────────────────────

export const TICKET_CATEGORIES = ["it", "hr", "payroll", "facilities", "finance", "other"] as const;
export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const TICKET_STATUSES = ["open", "in_progress", "waiting_on_requester", "resolved", "closed"] as const;

export interface TicketComment {
  id: string;
  authorUserId: string;
  authorName: string;
  body: string;
  internal: boolean;
  attachmentFileIds: string[];
  createdAt: string;
}

export interface Ticket {
  id: string;
  number: number;
  subject: string;
  description: string;
  category: (typeof TICKET_CATEGORIES)[number];
  priority: (typeof TICKET_PRIORITIES)[number];
  status: (typeof TICKET_STATUSES)[number];
  requester: { id: string; name?: string; email?: string; employeeCode?: string | null; department?: string | null };
  assignee: { id: string; name: string; email: string } | null;
  attachmentFileIds: string[];
  comments?: TicketComment[];
  commentCount: number;
  dueAt: string | null;
  isOverdue: boolean;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  resolutionNote: string;
  rating: number | null;
  ratingComment: string;
  tags: string[];
  lastActivityAt: string;
  createdAt: string;
}

export interface TicketStats {
  open: number;
  inProgress: number;
  waiting: number;
  unassigned: number;
  overdue: number;
  mine: number;
  resolvedThisWeek: number;
  averageRating: number | null;
  ratings: number;
}

// ── Expenses ────────────────────────────────────────────────────────────────

export interface ExpenseLine {
  id?: string;
  date: string;
  category: string;
  description?: string;
  amount: number;
  receiptFileId: string | null;
  distanceKm?: number | null;
}

export interface ExpenseClaim {
  id: string;
  number: number;
  title: string;
  purpose: string;
  lines: ExpenseLine[];
  total: number;
  advanceAmount: number;
  approvedTotal: number | null;
  payable: number;
  status: "draft" | "submitted" | "approved" | "rejected" | "reimbursed" | "cancelled";
  submittedAt: string | null;
  employee: EmployeeRef;
  approverUserIds: string[];
  viaWorkflow: boolean;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionComment: string;
  reimbursement: { method: string; reference: string; paidAt: string | null; viaPayroll: boolean; paidBy: string | null } | null;
  createdAt: string;
}

export interface ExpensePolicy {
  categories: string[];
  maxClaim: number;
  receiptAbove: number;
  mileageRate: number;
}

// ── Assets ──────────────────────────────────────────────────────────────────

export const ASSET_CATEGORIES = ["laptop", "desktop", "monitor", "phone", "sim", "id_card", "access_card", "vehicle", "furniture", "tool", "uniform", "software_licence", "other"] as const;
export const ASSET_STATUSES = ["available", "assigned", "in_repair", "lost", "retired"] as const;
export const ASSET_CONDITIONS = ["new", "good", "fair", "poor", "damaged"] as const;

export interface AssetAssignment {
  id: string;
  assetId: string;
  employee: EmployeeRef;
  assignedOn: string;
  expectedReturnOn: string | null;
  isOverdue: boolean;
  conditionAtAssignment: string;
  notes: string;
  acknowledgedAt: string | null;
  acknowledgedName: string;
  returnedOn: string | null;
  conditionAtReturn: string | null;
  returnNotes: string;
  returnedTo: string | null;
  recoveryAmount: number;
  asset?: { id: string; tag: string; name: string; category: string; serialNumber: string; condition: string };
}

export interface Asset {
  id: string;
  tag: string;
  name: string;
  category: (typeof ASSET_CATEGORIES)[number];
  make: string;
  model: string;
  serialNumber: string;
  purchaseDate: string | null;
  purchaseCost: number | null;
  vendor: string;
  warrantyUntil: string | null;
  warrantyExpired: boolean;
  location: { id: string; name: string } | null;
  notes: string;
  status: (typeof ASSET_STATUSES)[number];
  condition: (typeof ASSET_CONDITIONS)[number];
  assignedTo: EmployeeRef | null;
  currentAssignmentId: string | null;
  history?: AssetAssignment[];
  createdAt: string;
}

export interface AssetStats {
  total: number;
  available: number;
  assigned: number;
  inRepair: number;
  lost: number;
  retired: number;
  totalValue: number;
  warrantyExpiring: number;
  overdueReturns: number;
}

// ── Loans ───────────────────────────────────────────────────────────────────

export interface Loan {
  id: string;
  number: number;
  type: "loan" | "advance";
  purpose: string;
  principal: number;
  interestRatePercent: number;
  instalments: number;
  instalmentAmount: number;
  totalRepayable: number;
  startPeriod: string;
  status: "requested" | "approved" | "active" | "closed" | "rejected" | "cancelled";
  employee: EmployeeRef;
  approvedBy: string | null;
  approvedAt: string | null;
  decisionComment: string;
  disbursedOn: string | null;
  disbursedVia: string | null;
  disbursementReference: string;
  manualRepayments: Array<{ amount: number; on: string; reference: string }>;
  closedAt: string | null;
  closeReason: string;
  outstanding: number;
  instalmentsRemaining: number;
  schedule?: Array<{ id: string; periodKey: string; amount: number; status: string; appliedAt: string | null }>;
  createdAt: string;
}

export interface LoanSchedulePreview {
  totalRepayable: number;
  instalmentAmount: number;
  interest: number;
  rows: Array<{ index: number; periodKey: string; amount: number }>;
}

export interface PayrollInput {
  id: string;
  employeeId: string;
  employee: EmployeeRef | null;
  type: "earning" | "deduction";
  label: string;
  amount: number;
  reason: string;
  periodKey: string | null;
  source: { type: string; id: string | null; reference: string };
  status: "pending" | "applied" | "cancelled";
  appliedRunId: string | null;
  appliedAt: string | null;
  createdAt: string;
}

export function periodLabel(periodKey: string | null | undefined) {
  if (!periodKey) return "next run";
  const [y, m] = periodKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en", { month: "short", year: "numeric", timeZone: "UTC" });
}
