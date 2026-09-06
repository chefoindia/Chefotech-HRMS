import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, tokens } from "./client";
import { formWithFile, type PickedFile } from "../lib/files";

/**
 * Typed bindings to the employee-facing endpoints.
 *
 * Every shape here mirrors what the API returns — the same shapes the web
 * portal (frontend/lib/types.ts and friends) is built on — so a screen that
 * compiles is a screen whose fields exist, and the phone shows exactly what
 * the browser shows.
 */

// ── Shared shapes ────────────────────────────────────────────────────────────

export interface Ref {
  id?: string;
  _id?: string;
  name?: string;
  code?: string;
}

export interface StoredFileRef {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  downloadUrl: string;
  url?: string | null;
}

export interface Breakdown {
  rule: string;
  detail: string;
  effect: string;
}

// ── Attendance ──────────────────────────────────────────────────────────────

export interface TodayStatus {
  date: string;
  timezone: string;
  isCheckedIn: boolean;
  nextDirection: "in" | "out";
  firstIn: string | null;
  lastOut: string | null;
  status: string | null;
  workedMinutes: number;
  shift: { name?: string; startTime?: string; endTime?: string } | null;
  punches: { id: string; at: string; direction: "in" | "out" | null; source: string; isWithinGeofence: boolean | null }[];
}

export interface AttendanceRecord {
  id?: string;
  date: string;
  status: string;
  shiftCode: string | null;
  firstPunchAt: string | null;
  lastPunchAt: string | null;
  workedMinutes: number;
  effectiveMinutes: number;
  lateByMinutes: number;
  earlyLeavingByMinutes: number;
  overtimeMinutes: number;
  isLate: boolean;
  isEarlyLeaving: boolean;
  isMissingPunch: boolean;
  payableDays: number;
  holidayName: string | null;
  leaveType: string | null;
  isLocked: boolean;
  isManualOverride: boolean;
  breakdown: Breakdown[];
  punches?: { at: string; direction: string | null; source: string; isManual: boolean }[];
}

export interface AttendanceSummary {
  present: number;
  absent: number;
  halfDay: number;
  leave: number;
  weeklyOff: number;
  holiday: number;
  late: number;
  earlyLeaving: number;
  missingPunch: number;
  payableDays: number;
  workedHours: number;
  overtimeHours: number;
  compOffEarned: number;
}

export const todayKey = ["attendance", "today"];

export function useToday() {
  return useQuery<TodayStatus>({
    queryKey: todayKey,
    queryFn: async () => (await api.get<TodayStatus>("/attendance/me/today")).data,
    // The clock-in state is the one thing on screen that is worthless when
    // stale, so it is refreshed far more eagerly than anything else.
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
}

export function usePunch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { direction?: "in" | "out"; location?: { latitude: number; longitude: number; accuracy?: number }; note?: string }) =>
      api.post<{ duplicate?: boolean }>("/attendance/punch", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: todayKey });
      queryClient.invalidateQueries({ queryKey: ["attendance", "month"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useMonthAttendance(year: number, month: number) {
  return useQuery<{ days: AttendanceRecord[]; summary: AttendanceSummary }>({
    queryKey: ["attendance", "month", year, month],
    queryFn: async () => (await api.get<{ days: AttendanceRecord[]; summary: AttendanceSummary }>("/attendance/me", { query: { year, month } })).data,
  });
}

export const CORRECTION_TYPES = [
  { value: "missing_punch", label: "A punch is missing" },
  { value: "forgot_to_punch", label: "I forgot to punch" },
  { value: "wrong_punch", label: "The recorded time is wrong" },
  { value: "on_duty", label: "I was on duty elsewhere" },
  { value: "work_from_home", label: "I worked from home" },
] as const;

export function useRequestCorrection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { date: string; type: string; requested: { checkIn: string | null; checkOut: string | null }; reason: string }) => api.post("/attendance/me/corrections", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
    },
  });
}

// ── Dashboard ───────────────────────────────────────────────────────────────

export interface DashboardData {
  hasEmployeeRecord: boolean;
  date: string;
  employee: Employee | null;
  today: AttendanceRecord | null;
  nextPunchDirection: "in" | "out";
  monthSummary: AttendanceSummary;
  leaveBalances: LeaveBalance[];
  pendingLeave: LeaveRequest[];
  upcomingHolidays: { _id: string; name: string; date: string }[];
}

export function useDashboard() {
  return useQuery<DashboardData>({
    queryKey: ["dashboard", "me"],
    queryFn: async () => (await api.get<DashboardData>("/dashboard/me")).data,
    staleTime: 60_000,
  });
}

// ── Leave ───────────────────────────────────────────────────────────────────

export interface LeaveType {
  id: string;
  name: string;
  code: string;
  colour: string;
  isPaid: boolean;
  allowHalfDay: boolean;
  requiresAttachment: boolean;
  attachmentRequiredAfterDays: number;
}

export interface LeaveBalance {
  leaveType: LeaveType;
  hasBalance: boolean;
  year?: number;
  allocated?: number;
  used?: number;
  pending?: number;
  available: number | null;
  eligible: boolean;
  ineligibleReasons: string[];
}

export interface LeaveRequest {
  id: string;
  leaveTypeId: LeaveType | string;
  fromDate: string;
  toDate: string;
  fromPortion: string;
  toPortion: string;
  calendarDays: number;
  leaveDays: number;
  reason: string;
  status: "draft" | "pending" | "approved" | "rejected" | "cancelled" | "withdrawn";
  rejectionReason: string;
  createdAt: string;
}

export interface LeavePreview {
  leaveType: LeaveType;
  calendarDays: number;
  leaveDays: number;
  days: { date: string; portion: string; deductedDays: number; isHoliday: boolean; isWeeklyOff: boolean; reason: string | null }[];
  breakdown: Breakdown[];
  balanceAvailable: number | null;
  balanceAfter: number | null;
  canApply: boolean;
  problems: string[];
  attachmentRequired: boolean;
}

export function leaveTypeOf(request: LeaveRequest): LeaveType | null {
  return typeof request.leaveTypeId === "object" && request.leaveTypeId ? request.leaveTypeId : null;
}

export function useLeaveBalances() {
  return useQuery<LeaveBalance[]>({
    queryKey: ["leave", "balances"],
    queryFn: async () => (await api.get<LeaveBalance[]>("/leave/me/balances")).data,
  });
}

export function useLeaveRequests() {
  return useQuery<LeaveRequest[]>({
    queryKey: ["leave", "requests"],
    queryFn: async () => (await api.get<LeaveRequest[]>("/leave/requests", { query: { limit: 50 } })).data,
  });
}

/**
 * The cost preview: computed by the same engine that will do the real
 * deduction, never re-implemented on the phone.
 */
export function useLeavePreview() {
  return useMutation({
    mutationFn: (input: { leaveTypeId: string; fromDate: string; toDate: string; fromPortion?: string; toPortion?: string }) => api.post<LeavePreview>("/leave/me/preview", input),
  });
}

export function useApplyLeave() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { leaveTypeId: string; fromDate: string; toDate: string; reason: string; fromPortion?: string; toPortion?: string }) => api.post("/leave/me/apply", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave"] });
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useCancelLeave() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/leave/requests/${id}/cancel`, { reason: "Cancelled by employee" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useLeaveTypes() {
  return useQuery<LeaveType[]>({
    queryKey: ["leave", "types"],
    queryFn: async () => (await api.get<LeaveType[]>("/leave/types", { query: { limit: 100 } })).data,
    staleTime: 30 * 60_000,
  });
}

// ── Payroll ─────────────────────────────────────────────────────────────────

export interface Payslip {
  id: string;
  payslipNumber: string;
  periodLabel: string;
  gross: number;
  totalDeductions: number;
  net: number;
  publishedAt: string;
  periodId: { name: string; payDate: string; year?: number; month?: number } | string;
  snapshot?: {
    lines: { code: string; name: string; type: string; amount: number; showOnPayslip: boolean }[];
    attendance: { totalDays: number; payableDays: number; lossOfPayDays: number; paidLeaveDays: number };
    breakdown: Breakdown[];
  };
}

export function usePayslips() {
  return useQuery<Payslip[]>({
    queryKey: ["payroll", "payslips"],
    queryFn: async () => (await api.get<Payslip[]>("/payroll/me/payslips")).data,
  });
}

export function usePayslip(id: string | null) {
  return useQuery<Payslip>({
    queryKey: ["payroll", "payslip", id],
    queryFn: async () => (await api.get<Payslip>(`/payroll/payslips/${id}`)).data,
    enabled: Boolean(id),
  });
}

// ── Profile ─────────────────────────────────────────────────────────────────

export interface Employee {
  id: string;
  employeeCode: string;
  fullName: string;
  avatarUrl: string | null;
  status: string;
  personal: {
    firstName: string;
    middleName?: string;
    lastName: string;
    displayName?: string;
    workEmail?: string;
    personalEmail?: string;
    phone?: string;
    alternatePhone?: string;
    currentAddress?: Record<string, string>;
  };
  employment: {
    departmentId: Ref | string | null;
    designationId: Ref | string | null;
    locationId: Ref | string | null;
    managerId: { id?: string; _id?: string; employeeCode?: string; personal?: { firstName: string; lastName: string } } | string | null;
    employmentType: string;
    workMode?: string;
    joiningDate: string | null;
    confirmationDate?: string | null;
  };
  skills?: string[];
}

export function useProfile() {
  return useQuery<Employee>({
    queryKey: ["employees", "me"],
    queryFn: async () => (await api.get<Employee>("/employees/me")).data,
    staleTime: 10 * 60_000,
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { personal: Record<string, unknown> }) => api.patch<{ applied: string[]; rejected: string[] }>("/employees/me", body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employees", "me"] }),
  });
}

export function useUploadAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ employeeId, file }: { employeeId: string; file: PickedFile }) => api.upload(`/employees/${employeeId}/avatar`, formWithFile(file)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employees", "me"] }),
  });
}

// ── Documents ───────────────────────────────────────────────────────────────

export interface EmployeeDocument {
  id: string;
  name: string;
  category: string;
  status: "pending_review" | "verified" | "rejected" | "expired";
  documentNumber: string;
  issuedOn: string | null;
  expiresOn: string | null;
  isExpired: boolean;
  daysToExpiry: number | null;
  source: string;
  version: number;
  notes: string;
  rejectionReason?: string;
  createdAt: string;
  file: StoredFileRef | null;
  acknowledgement: { required: boolean; requestedAt: string | null; dueOn: string | null; acknowledgedAt: string | null; acknowledgedName: string; isOverdue: boolean };
}

export interface DocumentRequest {
  id: string;
  name: string;
  category: string;
  note: string;
  dueOn: string | null;
  status: "pending" | "fulfilled" | "cancelled";
  isOverdue: boolean;
  requestedBy: string | null;
  createdAt: string;
}

export interface CompanyDocument {
  id: string;
  title: string;
  description: string;
  category: string;
  version: string;
  effectiveFrom: string | null;
  requireAcknowledgement: boolean;
  acknowledged: boolean;
  acknowledgedAt: string | null;
  publishedAt: string;
  file: StoredFileRef | null;
}

export function useMyDocuments() {
  return useQuery<EmployeeDocument[]>({
    queryKey: ["documents", "me"],
    queryFn: async () => (await api.get<EmployeeDocument[]>("/documents/me")).data,
  });
}

export function useDocumentRequests() {
  return useQuery<DocumentRequest[]>({
    queryKey: ["documents", "requests", "me"],
    queryFn: async () => (await api.get<DocumentRequest[]>("/documents/requests/me")).data,
  });
}

export function useCompanyDocuments() {
  return useQuery<CompanyDocument[]>({
    queryKey: ["documents", "company"],
    queryFn: async () => (await api.get<CompanyDocument[]>("/documents/company")).data,
  });
}

export function useAcknowledgeDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name, company }: { id: string; name: string; company?: boolean }) => api.post(company ? `/documents/company/${id}/acknowledge` : `/documents/${id}/acknowledge`, { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["documents"] }),
  });
}

export function useUploadDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, requestId, documentNumber, expiresOn, notes }: { file: PickedFile; requestId: string; documentNumber?: string; expiresOn?: string; notes?: string }) =>
      api.upload("/documents/me", formWithFile(file, { requestId, documentNumber, expiresOn, notes })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["documents"] }),
  });
}

// ── Holidays ────────────────────────────────────────────────────────────────

export interface Holiday {
  id: string;
  name: string;
  date: string;
  isOptional?: boolean;
  selected?: boolean;
}

export function useHolidays() {
  return useQuery<Holiday[]>({
    queryKey: ["holidays", "me"],
    queryFn: async () => {
      const { data } = await api.get<{ holidays: Array<Holiday & { _id?: string }>; optional: Array<Holiday & { _id?: string }> }>("/holidays/me");
      const all = [...(data?.holidays || []), ...(data?.optional || []).map((h) => ({ ...h, isOptional: true }))];
      return all.map((h) => ({ ...h, id: String(h.id || h._id) })).sort((a, b) => a.date.localeCompare(b.date));
    },
    staleTime: 60 * 60_000,
  });
}

// ── Notifications ───────────────────────────────────────────────────────────

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  actionUrl: string | null;
  severity: "info" | "success" | "warning" | "critical";
  category: string;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationSummary {
  category: string;
  total: number;
  unread: number;
}

export interface Announcement {
  id: string;
  title: string;
  message: string;
  requireAcknowledgement: boolean;
  sentAt: string | null;
  pinnedUntil: string | null;
  createdAt: string;
  createdBy: string | null;
  acknowledged?: boolean;
  acknowledgedAt?: string | null;
}

export const NOTIFICATION_CATEGORY_LABELS: Record<string, string> = {
  leave: "Leave",
  attendance: "Attendance",
  payroll: "Payroll",
  document: "Documents",
  workflow: "Approvals",
  employee: "People",
  system: "Account",
  announcement: "Announcements",
  ticket: "Help desk",
  expense: "Expenses",
  asset: "Assets",
};

export function useNotifications(params: { page?: number; q?: string; unreadOnly?: boolean; category?: string } = {}) {
  return useQuery<{ items: NotificationItem[]; total: number; totalPages: number }>({
    queryKey: ["notifications", "list", params],
    queryFn: async () => {
      const response = await api.get<NotificationItem[]>("/notifications", {
        query: { page: params.page || 1, limit: 30, q: params.q || undefined, unreadOnly: params.unreadOnly ? "true" : undefined, category: params.category || undefined },
      });
      return { items: response.data || [], total: response.meta?.total || 0, totalPages: response.meta?.totalPages || 1 };
    },
  });
}

export function useNotificationSummary() {
  return useQuery<NotificationSummary[]>({
    queryKey: ["notifications", "summary"],
    queryFn: async () => (await api.get<NotificationSummary[]>("/notifications/summary")).data,
  });
}

export function useAnnouncements() {
  return useQuery<Announcement[]>({
    queryKey: ["notifications", "announcements"],
    queryFn: async () => (await api.get<Announcement[]>("/notifications/announcements", { query: { scope: "mine", limit: 50 } })).data,
  });
}

export function useUnreadCount() {
  return useQuery<number>({
    queryKey: ["notifications", "unread"],
    queryFn: async () => {
      const { data } = await api.get<{ count?: number; unread?: number } | number>("/notifications/unread-count");
      if (typeof data === "number") return data;
      return data?.count ?? data?.unread ?? 0;
    },
    refetchInterval: 60_000,
  });
}

function useNotificationMutation<TInput>(run: (input: TInput) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

/** Mark some (ids) or all (no ids) as read. */
export function useMarkNotificationsRead() {
  return useNotificationMutation((ids?: string[]) => api.post("/notifications/read", ids ? { ids } : {}));
}
export function useMarkNotificationRead() {
  return useNotificationMutation((id: string) => api.post("/notifications/read", { ids: [id] }));
}
export function useMarkNotificationUnread() {
  return useNotificationMutation((id: string) => api.post(`/notifications/${id}/unread`));
}
export function useDeleteNotification() {
  return useNotificationMutation((id: string) => api.delete(`/notifications/${id}`));
}
export function useClearReadNotifications() {
  return useNotificationMutation(() => api.post<{ deleted: number }>("/notifications/clear-read"));
}
export function useAcknowledgeAnnouncement() {
  return useNotificationMutation((id: string) => api.post(`/notifications/announcements/${id}/acknowledge`));
}

export interface NotificationPreferences {
  emailEnabled: boolean;
  pushEnabled: boolean;
  dailyDigest: boolean;
  muted: { category: string; channel: "email" | "push" }[];
  quietHours: { enabled: boolean; start: string; end: string };
  categories?: string[];
  isDefault?: boolean;
}

export function useNotificationPreferences() {
  return useQuery<NotificationPreferences>({
    queryKey: ["notifications", "preferences"],
    queryFn: async () => (await api.get<NotificationPreferences>("/notifications/preferences")).data,
    staleTime: 5 * 60_000,
  });
}

export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<NotificationPreferences>) => {
      const { categories, isDefault, ...rest } = body;
      void categories;
      void isDefault;
      return api.put<NotificationPreferences>("/notifications/preferences", rest);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications", "preferences"] }),
  });
}

export interface PushDevice {
  id: string;
  kind: "expo" | "web";
  platform: string;
  deviceName: string;
  appVersion: string;
  lastSeenAt: string;
  lastDeliveredAt: string | null;
  isActive: boolean;
  disabledReason: string | null;
}

export function usePushDevices() {
  return useQuery<PushDevice[]>({
    queryKey: ["notifications", "devices"],
    queryFn: async () => (await api.get<PushDevice[]>("/notifications/devices")).data,
  });
}

export function useTestPush() {
  return useMutation({
    mutationFn: async () => (await api.post<{ attempted: number; delivered: number; noDevices?: boolean }>("/notifications/devices/test")).data,
  });
}

// ── Requests ────────────────────────────────────────────────────────────────

export interface RequestTypeInfo {
  key: string;
  label: string;
  description: string;
  approver: "manager" | "hr";
}

export interface EmployeeRequestItem {
  id: string;
  type: string;
  typeLabel: string;
  payload: Record<string, unknown>;
  reason: string;
  summary: string;
  status: "pending" | "approved" | "rejected" | "cancelled" | "completed";
  viaWorkflow: boolean;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionComment: string;
  effect: Record<string, unknown> | null;
  createdAt: string;
}

export function useRequestTypes() {
  return useQuery<RequestTypeInfo[]>({
    queryKey: ["requests", "types"],
    queryFn: async () => (await api.get<RequestTypeInfo[]>("/requests/types")).data,
    staleTime: 10 * 60_000,
  });
}

export function useMyRequests() {
  return useQuery<EmployeeRequestItem[]>({
    queryKey: ["requests", "mine"],
    queryFn: async () => (await api.get<EmployeeRequestItem[]>("/requests", { query: { scope: "mine", limit: 100 } })).data,
  });
}

export function useSubmitRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { type: string; payload: Record<string, unknown>; reason?: string }) => api.post<EmployeeRequestItem>("/requests", body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["requests"] }),
  });
}

export function useCancelRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/requests/${id}/cancel`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["requests"] }),
  });
}

// ── Reference lists (for pickers) ───────────────────────────────────────────

export interface NamedRef {
  id: string;
  name: string;
  code?: string;
}

function useNamedList(key: string, path: string, enabled = true) {
  return useQuery<NamedRef[]>({
    queryKey: ["ref", key],
    queryFn: async () => {
      const { data } = await api.get<NamedRef[]>(path, { query: { limit: 200 } });
      return Array.isArray(data) ? data : [];
    },
    enabled,
    staleTime: 10 * 60_000,
  });
}

export function useDepartments(enabled = true) {
  return useNamedList("departments", "/departments", enabled);
}
export function useLocations(enabled = true) {
  return useNamedList("locations", "/locations", enabled);
}
export function useShifts(enabled = true) {
  return useQuery<Array<NamedRef & { startTime?: string; endTime?: string }>>({
    queryKey: ["ref", "shifts"],
    queryFn: async () => {
      const { data } = await api.get<Array<NamedRef & { startTime?: string; endTime?: string }>>("/shifts", { query: { limit: 200 } });
      return Array.isArray(data) ? data : [];
    },
    enabled,
    staleTime: 10 * 60_000,
  });
}

// ── Directory ───────────────────────────────────────────────────────────────

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

export function useDirectory(params: { q?: string; departmentId?: string; locationId?: string; page?: number }) {
  return useQuery<{ items: DirectoryEntry[]; total: number }>({
    queryKey: ["directory", params],
    queryFn: async () => {
      const response = await api.get<DirectoryEntry[]>("/employees/directory", { query: { q: params.q || undefined, departmentId: params.departmentId || undefined, locationId: params.locationId || undefined, page: params.page || 1, limit: 60 } });
      return { items: response.data || [], total: response.meta?.total || 0 };
    },
    placeholderData: (previous) => previous,
  });
}

// ── Onboarding ──────────────────────────────────────────────────────────────

export interface LifecycleTask {
  id: string;
  title: string;
  description: string;
  owner: string;
  assignee: string | null;
  status: "pending" | "done" | "skipped";
  completedAt: string | null;
  completedBy: string | null;
  note: string;
  dueOn?: string | null;
  isOverdue?: boolean;
}

export interface Onboarding {
  id: string;
  joiningDate: string | null;
  buddy: { id: string; name: string } | null;
  welcomeNote: string;
  tasks: LifecycleTask[];
  progress: { done: number; total: number; percent: number };
  status: "in_progress" | "completed" | "cancelled";
}

export const TASK_OWNER_LABELS: Record<string, string> = { hr: "HR", it: "IT", finance: "Finance", admin: "Admin", manager: "Manager", employee: "You" };

export function useMyOnboarding() {
  return useQuery<Onboarding | null>({
    queryKey: ["onboarding", "me"],
    queryFn: async () => (await api.get<Onboarding | null>("/onboarding/me")).data,
  });
}

export function useCompleteOnboardingTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ onboardingId, taskId, status, note }: { onboardingId: string; taskId: string; status: "done" | "skipped"; note: string }) => api.post(`/onboarding/${onboardingId}/tasks/${taskId}/complete`, { status, note }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["onboarding"] }),
  });
}

// ── Help desk ───────────────────────────────────────────────────────────────

export interface TicketComment {
  id: string;
  authorUserId: string;
  authorName: string;
  body: string;
  internal: boolean;
  createdAt: string;
}

export interface TicketItem {
  id: string;
  number: number;
  subject: string;
  description: string;
  category: string;
  priority: string;
  status: "open" | "in_progress" | "waiting_on_requester" | "resolved" | "closed";
  requester: { id: string; name?: string; department?: string | null };
  assignee: { id: string; name: string } | null;
  comments?: TicketComment[];
  commentCount: number;
  dueAt: string | null;
  isOverdue: boolean;
  closedAt: string | null;
  resolutionNote: string;
  rating: number | null;
  ratingComment: string;
  lastActivityAt: string;
  createdAt: string;
}

export function useMyTickets() {
  return useQuery<TicketItem[]>({
    queryKey: ["tickets", "mine"],
    queryFn: async () => (await api.get<TicketItem[]>("/tickets", { query: { scope: "mine", limit: 100 } })).data,
  });
}

export function useTicket(id: string | null) {
  return useQuery<TicketItem>({
    queryKey: ["tickets", id],
    queryFn: async () => (await api.get<TicketItem>(`/tickets/${id}`)).data,
    enabled: Boolean(id),
  });
}

export function useCreateTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { subject: string; description: string; category: string; priority: string }) => (await api.post<TicketItem>("/tickets", body)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tickets"] }),
  });
}

export function useTicketAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, body, rating, ratingComment }: { id: string; action: "comment" | "close" | "reopen"; body?: string; rating?: number; ratingComment?: string }) => {
      if (action === "comment") return api.post(`/tickets/${id}/comments`, { body });
      if (action === "close") return api.post(`/tickets/${id}/close`, rating ? { rating, ratingComment } : {});
      return api.post(`/tickets/${id}/reopen`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tickets"] }),
  });
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

export interface ExpenseItem {
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
  viaWorkflow: boolean;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionComment: string;
  reimbursement: { method: string; reference: string; paidAt: string | null; viaPayroll: boolean } | null;
  createdAt: string;
}

export interface ExpensePolicy {
  categories: string[];
  maxClaim: number;
  receiptAbove: number;
  mileageRate: number;
}

export function useExpensePolicy() {
  return useQuery<ExpensePolicy>({
    queryKey: ["expenses", "policy"],
    queryFn: async () => (await api.get<ExpensePolicy>("/expenses/policy")).data,
    staleTime: 10 * 60_000,
  });
}

export function useMyExpenses() {
  return useQuery<ExpenseItem[]>({
    queryKey: ["expenses", "mine"],
    queryFn: async () => (await api.get<ExpenseItem[]>("/expenses", { query: { scope: "mine", limit: 100 } })).data,
  });
}

export interface ExpenseDraft {
  title: string;
  purpose: string;
  advanceAmount: number;
  lines: ExpenseLine[];
}

export function useSaveExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, draft, submit }: { id?: string | null; draft: ExpenseDraft; submit: boolean }) => {
      const body = { ...draft, lines: draft.lines.map((l) => ({ date: l.date, category: l.category, description: l.description || "", amount: Number(l.amount) || 0, receiptFileId: l.receiptFileId || null, distanceKm: l.distanceKm || null })) };
      if (id) {
        await api.patch(`/expenses/${id}`, body);
        if (submit) await api.post(`/expenses/${id}/submit`);
        return;
      }
      await api.post("/expenses", { ...body, submit });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["expenses"] }),
  });
}

export function useWithdrawExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/expenses/${id}/withdraw`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["expenses"] }),
  });
}

export function useUploadReceipt() {
  return useMutation({
    mutationFn: async ({ file, employeeId }: { file: PickedFile; employeeId?: string | null }) =>
      (await api.upload<{ id: string }>("/files", formWithFile(file, { category: "attachment", ownerType: "ExpenseClaim", ownerId: employeeId || undefined }))).data,
  });
}

// ── Assets ──────────────────────────────────────────────────────────────────

export interface AssetItem {
  id: string;
  assetId: string;
  assignedOn: string;
  expectedReturnOn: string | null;
  isOverdue: boolean;
  conditionAtAssignment: string;
  notes: string;
  acknowledgedAt: string | null;
  returnedOn: string | null;
  asset?: { id: string; tag: string; name: string; category: string; serialNumber: string; condition: string };
}

export function useMyAssets() {
  return useQuery<AssetItem[]>({
    queryKey: ["assets", "mine"],
    queryFn: async () => (await api.get<AssetItem[]>("/assets/me")).data,
  });
}

export function useAcknowledgeAsset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name?: string }) => api.post(`/assets/assignments/${id}/acknowledge`, name ? { name } : {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assets"] }),
  });
}

// ── Loans ───────────────────────────────────────────────────────────────────

export interface LoanItem {
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
  decisionComment: string;
  disbursedOn: string | null;
  disbursedVia: string | null;
  outstanding: number;
  instalmentsRemaining: number;
  schedule?: { id: string; periodKey: string; amount: number; status: string; appliedAt: string | null }[];
  createdAt: string;
}

export interface LoanSchedulePreview {
  totalRepayable: number;
  instalmentAmount: number;
  interest: number;
  rows: { index: number; periodKey: string; amount: number }[];
}

export function useMyLoans() {
  return useQuery<LoanItem[]>({
    queryKey: ["loans", "mine"],
    queryFn: async () => (await api.get<LoanItem[]>("/loans", { query: { scope: "mine", limit: 50 } })).data,
  });
}

export function useLoan(id: string | null) {
  return useQuery<LoanItem>({
    queryKey: ["loans", id],
    queryFn: async () => (await api.get<LoanItem>(`/loans/${id}`)).data,
    enabled: Boolean(id),
  });
}

export function useLoanLimits() {
  return useQuery<{ maxAmount: number; maxInstalments: number; maxActive: number }>({
    queryKey: ["loans", "limits"],
    queryFn: async () => (await api.get<{ maxAmount: number; maxInstalments: number; maxActive: number }>("/loans/limits")).data,
    staleTime: 10 * 60_000,
  });
}

export function useRequestLoan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { type: "loan" | "advance"; principal: number; instalments: number; purpose?: string; startPeriod?: string }) => (await api.post<LoanItem>("/loans", body)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["loans"] }),
  });
}

export function useLoanPreview(principal: number, instalments: number, startPeriod?: string) {
  return useQuery<LoanSchedulePreview>({
    queryKey: ["loans", "preview", principal, instalments, startPeriod || ""],
    queryFn: async () => (await api.post<LoanSchedulePreview>("/loans/preview", { principal, instalments, startPeriod: startPeriod || undefined })).data,
    enabled: principal > 0 && instalments > 0,
  });
}

// ── Surveys ─────────────────────────────────────────────────────────────────

export interface SurveyQuestionItem {
  id: string;
  type: "rating" | "scale" | "single" | "multi" | "yes_no" | "text";
  prompt: string;
  help: string;
  options: string[];
  required: boolean;
  max: number;
  lowLabel: string;
  highLabel: string;
}

export interface SurveyItem {
  id: string;
  title: string;
  description: string;
  questions: SurveyQuestionItem[];
  anonymous: boolean;
  closesAt: string | null;
  responded: boolean;
}

export function useMySurveys() {
  return useQuery<SurveyItem[]>({
    queryKey: ["surveys", "mine"],
    queryFn: async () => (await api.get<SurveyItem[]>("/surveys/me")).data,
  });
}

export function useRespondSurvey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, answers }: { id: string; answers: { questionId: string; value: unknown }[] }) => (await api.post(`/surveys/me/${id}/respond`, { answers })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["surveys"] }),
  });
}

// ── Performance ─────────────────────────────────────────────────────────────

export interface GoalItem {
  id: string;
  title: string;
  description: string;
  metric: string;
  target: string;
  weight: number;
  progress: number;
  status: "active" | "completed" | "cancelled";
  dueDate: string | null;
  alignedTo: { id: string; title: string } | null;
  updates: { at: string; byName: string; progress: number; note: string }[];
}

export interface ReviewSectionItem {
  key: string;
  title: string;
  description: string;
  rated: boolean;
}

export interface ReviewItem {
  id: string;
  cycle: { id: string; name?: string; status?: string; sections?: ReviewSectionItem[]; ratingScale?: number; selfDueAt?: string | null };
  reviewer: { id: string; name?: string } | null;
  status: "pending_self" | "pending_manager" | "completed" | "acknowledged";
  self: { ratings: Record<string, number>; answers: Record<string, string>; submittedAt: string | null };
  manager: { ratings: Record<string, number>; answers: Record<string, string>; overallRating: number | null; summary: string; submittedAt: string | null } | null;
  goals: { title: string; progress: number; weight: number }[];
  employeeComment: string;
  acknowledgedAt: string | null;
}

export function useMyGoals() {
  return useQuery<GoalItem[]>({
    queryKey: ["performance", "goals", "mine"],
    queryFn: async () => (await api.get<GoalItem[]>("/performance/goals", { query: { scope: "mine" } })).data,
  });
}

export function useCreateGoal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { title: string; description?: string; metric?: string; target?: string; weight?: number; dueDate?: string | null }) => (await api.post<GoalItem>("/performance/goals", body)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["performance"] }),
  });
}

export function useUpdateGoalProgress() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, progress, note }: { id: string; progress: number; note?: string }) => (await api.post<GoalItem>(`/performance/goals/${id}/progress`, { progress, note })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["performance"] }),
  });
}

export function useMyReviews() {
  return useQuery<ReviewItem[]>({
    queryKey: ["performance", "reviews", "mine"],
    queryFn: async () => (await api.get<ReviewItem[]>("/performance/reviews/me")).data,
  });
}

export function useSubmitSelfReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ratings, answers }: { id: string; ratings: Record<string, number>; answers: Record<string, string> }) => (await api.post<ReviewItem>(`/performance/reviews/${id}/self`, { ratings, answers })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["performance"] }),
  });
}

export function useAcknowledgeReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, comment }: { id: string; comment?: string }) => (await api.post<ReviewItem>(`/performance/reviews/${id}/acknowledge`, { comment })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["performance"] }),
  });
}

// ── Account security ────────────────────────────────────────────────────────

export interface SecurityStatus {
  mfaEnabled: boolean;
  mfaEnabledAt: string | null;
  recoveryCodesRemaining: number;
  enforced: boolean;
  passwordChangedAt: string | null;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
}

export interface SessionRow {
  id: string;
  device: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

export interface HistoryRow {
  id: string;
  action: string;
  at: string;
  ip: string | null;
  device: string;
  description: string | null;
}

export function useSecurityStatus() {
  return useQuery<SecurityStatus>({
    queryKey: ["security", "status"],
    queryFn: async () => (await api.get<SecurityStatus>("/auth/security")).data,
  });
}

export function useSessions() {
  return useQuery<SessionRow[]>({
    queryKey: ["security", "sessions"],
    queryFn: async () => {
      const { refresh } = await tokens.get();
      return (await api.get<SessionRow[]>("/auth/sessions", { headers: { "X-Refresh-Token": refresh || "" } })).data;
    },
  });
}

export function useLoginHistory() {
  return useQuery<HistoryRow[]>({
    queryKey: ["security", "history"],
    queryFn: async () => (await api.get<HistoryRow[]>("/auth/login-history")).data,
  });
}

function useSecurityMutation<TInput, TOut = unknown>(run: (input: TInput) => Promise<TOut>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["security"] }),
  });
}

export function useRevokeSession() {
  return useSecurityMutation((id: string) => api.delete(`/auth/sessions/${id}`));
}
export function useRevokeOtherSessions() {
  return useSecurityMutation(async () => {
    const { refresh } = await tokens.get();
    return (await api.post<{ revoked: number }>("/auth/sessions/revoke-others", { refreshToken: refresh || undefined })).data;
  });
}
export function useChangePassword() {
  return useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) => api.post("/auth/change-password", body),
  });
}
export function useMfaSetup() {
  return useMutation({
    mutationFn: async () => (await api.post<{ secret: string; otpauthUrl: string; qrDataUrl: string | null }>("/auth/mfa/setup")).data,
  });
}
export function useMfaEnable() {
  return useSecurityMutation(async (token: string) => (await api.post<{ enabled: boolean; recoveryCodes: string[] }>("/auth/mfa/enable", { token })).data);
}
export function useMfaDisable() {
  return useSecurityMutation((body: { password: string; token: string }) => api.post("/auth/mfa/disable", body));
}
export function useMfaRecoveryCodes() {
  return useSecurityMutation(async (token: string) => (await api.post<{ recoveryCodes: string[] }>("/auth/mfa/recovery-codes", { token })).data);
}
