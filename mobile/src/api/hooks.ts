import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

/**
 * Typed bindings to the employee-facing endpoints.
 *
 * Every shape here mirrors what the API actually returns — verified against
 * the running server rather than assumed — so a screen that compiles is a
 * screen whose fields exist.
 */

// ── Types ───────────────────────────────────────────────────────────────────

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
  punches: {
    id: string;
    at: string;
    direction: "in" | "out" | null;
    source: string;
    isWithinGeofence: boolean | null;
  }[];
}

export interface AttendanceDay {
  date: string;
  status: string;
  firstIn?: string | null;
  lastOut?: string | null;
  workedMinutes?: number;
  payableDays?: number;
  isHoliday?: boolean;
  isWeeklyOff?: boolean;
  lateMinutes?: number;
  breakdown?: { rule: string; detail: string }[];
}

export interface LeaveBalance {
  leaveTypeId: string;
  leaveType?: { name: string; code: string; colour?: string };
  name?: string;
  allocated: number;
  used: number;
  pending?: number;
  available: number;
  unit?: string;
}

export interface LeavePreview {
  days: number;
  breakdown: { date: string; deducted: boolean; reason: string }[];
  balanceAfter?: number;
  warnings?: string[];
}

export interface LeaveRequest {
  id: string;
  leaveTypeName?: string;
  leaveType?: { name: string };
  fromDate: string;
  toDate: string;
  days: number;
  status: string;
  reason?: string;
  rejectionReason?: string;
  createdAt: string;
}

export interface Payslip {
  id: string;
  period: { label?: string; year: number; month: number };
  netPay: number;
  grossPay?: number;
  currency?: string;
  status: string;
  publishedAt?: string;
}

export interface EmployeeProfile {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  fullName?: string;
  workEmail?: string;
  personalEmail?: string;
  phone?: string;
  avatarUrl?: string | null;
  employment?: {
    designation?: { name: string } | string;
    department?: { name: string } | string;
    location?: { name: string } | string;
    joiningDate?: string;
    employmentType?: string;
    managerName?: string;
  };
}

export interface Holiday {
  id: string;
  name: string;
  date: string;
  isOptional?: boolean;
}

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  isRead: boolean;
  actionUrl?: string | null;
  createdAt: string;
}

// ── Attendance ──────────────────────────────────────────────────────────────

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
    mutationFn: (input: {
      direction?: "in" | "out";
      location?: { latitude: number; longitude: number; accuracy?: number };
      note?: string;
    }) => api.post<{ punch: unknown }>("/attendance/punch", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: todayKey });
      queryClient.invalidateQueries({ queryKey: ["attendance", "month"] });
    },
  });
}

export function useMonthAttendance(year: number, month: number) {
  return useQuery<{ days: AttendanceDay[]; summary?: Record<string, number> }>({
    queryKey: ["attendance", "month", year, month],
    queryFn: async () =>
      (
        await api.get<{ days: AttendanceDay[]; summary?: Record<string, number> }>(
          "/attendance/me",
          { query: { year, month } }
        )
      ).data,
  });
}

export function useRequestCorrection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { date: string; checkIn?: string; checkOut?: string; reason: string }) =>
      api.post("/attendance/me/corrections", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
    },
  });
}

// ── Leave ───────────────────────────────────────────────────────────────────

export function useLeaveBalances() {
  return useQuery<LeaveBalance[]>({
    queryKey: ["leave", "balances"],
    queryFn: async () => {
      const { data } = await api.get<LeaveBalance[] | { items: LeaveBalance[] }>(
        "/leave/me/balances"
      );
      return Array.isArray(data) ? data : (data?.items ?? []);
    },
  });
}

export function useLeaveRequests() {
  return useQuery<LeaveRequest[]>({
    queryKey: ["leave", "requests"],
    queryFn: async () => {
      // The server scopes this to the caller when they only hold `leave.apply`,
      // so no employeeId filter is sent — asking for someone else's requests is
      // refused rather than filtered, and passing our own would be redundant.
      const { data } = await api.get<{ items: LeaveRequest[] } | LeaveRequest[]>(
        "/leave/requests",
        { query: { limit: 50 } }
      );
      return Array.isArray(data) ? data : (data?.items ?? []);
    },
  });
}

/**
 * The cost preview.
 *
 * A mutation rather than a query because the server computes it from a
 * candidate request that does not exist yet — and because caching "what would
 * these dates cost" across edits would show a figure for the previous range.
 */
export function useLeavePreview() {
  return useMutation({
    mutationFn: (input: {
      leaveTypeId: string;
      fromDate: string;
      toDate: string;
      fromHalf?: boolean;
      toHalf?: boolean;
    }) => api.post<LeavePreview>("/leave/me/preview", input),
  });
}

export function useApplyLeave() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      leaveTypeId: string;
      fromDate: string;
      toDate: string;
      reason: string;
      fromHalf?: boolean;
      toHalf?: boolean;
    }) => api.post("/leave/me/apply", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave"] });
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
    },
  });
}

export function useLeaveTypes() {
  return useQuery<{ id: string; name: string; code: string; colour?: string }[]>({
    queryKey: ["leave", "types"],
    queryFn: async () => {
      const { data } = await api.get<{ items: any[] } | any[]>("/leave/types", {
        query: { limit: 100 },
      });
      return Array.isArray(data) ? data : (data?.items ?? []);
    },
    staleTime: 30 * 60_000,
  });
}

// ── Payroll ─────────────────────────────────────────────────────────────────

export function usePayslips() {
  return useQuery<Payslip[]>({
    queryKey: ["payroll", "payslips"],
    queryFn: async () => {
      const { data } = await api.get<{ items: Payslip[] } | Payslip[]>("/payroll/me/payslips", {
        query: { limit: 36 },
      });
      return Array.isArray(data) ? data : (data?.items ?? []);
    },
  });
}

// ── Profile, documents, holidays ────────────────────────────────────────────

export function useProfile() {
  return useQuery<EmployeeProfile>({
    queryKey: ["employees", "me"],
    queryFn: async () => (await api.get<EmployeeProfile>("/employees/me")).data,
    staleTime: 10 * 60_000,
  });
}

export function useMyDocuments() {
  return useQuery<{ id: string; fileName: string; category?: string; createdAt: string; url?: string }[]>({
    queryKey: ["documents", "me"],
    queryFn: async () => {
      const { data } = await api.get<{ items: any[] } | any[]>("/documents/me", {
        query: { limit: 100 },
      });
      return Array.isArray(data) ? data : (data?.items ?? []);
    },
  });
}

export function useHolidays() {
  return useQuery<Holiday[]>({
    queryKey: ["holidays", "me"],
    queryFn: async () => {
      const { data } = await api.get<{ items: Holiday[] } | Holiday[]>("/holidays/me");
      return Array.isArray(data) ? data : (data?.items ?? []);
    },
    staleTime: 60 * 60_000,
  });
}

// ── Notifications ───────────────────────────────────────────────────────────

export function useNotifications() {
  return useQuery<NotificationItem[]>({
    queryKey: ["notifications"],
    queryFn: async () => {
      const { data } = await api.get<{ items: NotificationItem[] } | NotificationItem[]>(
        "/notifications",
        { query: { limit: 50 } }
      );
      return Array.isArray(data) ? data : (data?.items ?? []);
    },
  });
}

export function useUnreadCount() {
  return useQuery<number>({
    queryKey: ["notifications", "unread"],
    queryFn: async () => {
      const { data } = await api.get<{ count: number }>("/notifications/unread-count");
      return data?.count ?? 0;
    },
    refetchInterval: 120_000,
  });
}

export interface NotificationPreferences {
  emailEnabled: boolean;
  pushEnabled: boolean;
  dailyDigest: boolean;
  muted: { category: string; channel: "email" | "push" }[];
  quietHours: { enabled: boolean; start: string; end: string };
  categories?: string[];
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
    mutationFn: (patch: Partial<NotificationPreferences>) =>
      api.put<NotificationPreferences>("/notifications/preferences", patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications", "preferences"] });
    },
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    // The API marks a batch, so one id is just a batch of one. Omitting `ids`
    // entirely would mark everything read, which is emphatically not what
    // tapping a single notification should do.
    mutationFn: (id: string) => api.post("/notifications/read", { ids: [id] }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

// ── Requests, help desk, expenses, assets, loans ────────────────────────────

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
    staleTime: 60 * 60_000,
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
    mutationFn: async (body: { type: string; payload: Record<string, unknown>; reason?: string }) => (await api.post<EmployeeRequestItem>("/requests", body)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["requests"] }),
  });
}

export function useCancelRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`/requests/${id}/cancel`)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["requests"] }),
  });
}

export interface TicketItem {
  id: string;
  number: number;
  subject: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  assignee: { id: string; name: string } | null;
  comments?: { id: string; authorUserId: string; authorName: string; body: string; internal: boolean; createdAt: string }[];
  commentCount: number;
  isOverdue: boolean;
  resolutionNote: string;
  rating: number | null;
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
    mutationFn: async (body: { subject: string; description?: string; category?: string; priority?: string }) => (await api.post<TicketItem>("/tickets", body)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tickets"] }),
  });
}

export function useTicketAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; action: "comment" | "close" | "reopen"; body?: string; rating?: number }) => {
      if (input.action === "comment") return (await api.post(`/tickets/${input.id}/comments`, { body: input.body })).data;
      if (input.action === "close") return (await api.post(`/tickets/${input.id}/close`, input.rating ? { rating: input.rating } : {})).data;
      return (await api.post(`/tickets/${input.id}/reopen`)).data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tickets"] }),
  });
}

export interface ExpenseItem {
  id: string;
  number: number;
  title: string;
  purpose: string;
  lines: { id?: string; date: string; category: string; description?: string; amount: number }[];
  total: number;
  approvedTotal: number | null;
  payable: number;
  status: string;
  submittedAt: string | null;
  decidedBy: string | null;
  decisionComment: string;
  reimbursement: { method: string; viaPayroll: boolean; paidAt: string | null } | null;
  createdAt: string;
}

export function useExpensePolicy() {
  return useQuery<{ categories: string[]; maxClaim: number; receiptAbove: number; mileageRate: number }>({
    queryKey: ["expenses", "policy"],
    queryFn: async () => (await api.get<{ categories: string[]; maxClaim: number; receiptAbove: number; mileageRate: number }>("/expenses/policy")).data,
    staleTime: 60 * 60_000,
  });
}

export function useMyExpenses() {
  return useQuery<ExpenseItem[]>({
    queryKey: ["expenses", "mine"],
    queryFn: async () => (await api.get<ExpenseItem[]>("/expenses", { query: { scope: "mine", limit: 100 } })).data,
  });
}

export function useCreateExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { title: string; purpose?: string; lines: { date: string; category: string; description?: string; amount: number }[]; submit: boolean }) => (await api.post<ExpenseItem>("/expenses", body)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["expenses"] }),
  });
}

export function useWithdrawExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post(`/expenses/${id}/withdraw`)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["expenses"] }),
  });
}

export interface AssetItem {
  id: string;
  assignedOn: string;
  expectedReturnOn: string | null;
  isOverdue: boolean;
  conditionAtAssignment: string;
  acknowledgedAt: string | null;
  asset?: { id: string; tag: string; name: string; category: string; serialNumber: string };
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
    mutationFn: async (input: { id: string; name: string }) => (await api.post(`/assets/assignments/${input.id}/acknowledge`, { name: input.name })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assets"] }),
  });
}

export interface LoanItem {
  id: string;
  number: number;
  type: "loan" | "advance";
  purpose: string;
  principal: number;
  instalments: number;
  instalmentAmount: number;
  totalRepayable: number;
  startPeriod: string;
  status: string;
  outstanding: number;
  instalmentsRemaining: number;
  decisionComment: string;
  createdAt: string;
}

export function useMyLoans() {
  return useQuery<LoanItem[]>({
    queryKey: ["loans", "mine"],
    queryFn: async () => (await api.get<LoanItem[]>("/loans", { query: { scope: "mine", limit: 50 } })).data,
  });
}

export function useRequestLoan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { type: "loan" | "advance"; principal: number; instalments: number; purpose?: string }) => (await api.post<LoanItem>("/loans", body)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["loans"] }),
  });
}

export function useLoanPreview(principal: number, instalments: number) {
  return useQuery<{ totalRepayable: number; instalmentAmount: number; rows: { periodKey: string; amount: number }[] }>({
    queryKey: ["loans", "preview", principal, instalments],
    queryFn: async () => (await api.post<{ totalRepayable: number; instalmentAmount: number; rows: { periodKey: string; amount: number }[] }>("/loans/preview", { principal, instalments })).data,
    enabled: principal > 0 && instalments > 0,
  });
}

// ── Surveys ──────────────────────────────────────────────────────────────────

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

// ── Performance ──────────────────────────────────────────────────────────────

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
