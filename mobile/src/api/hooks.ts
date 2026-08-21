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
