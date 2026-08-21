"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CalendarDays,
  Clock,
  FileText,
  LogIn,
  LogOut,
  PartyPopper,
  Wallet,
} from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatDate, formatMinutes, formatTime, humanise } from "@/lib/format";
import { refLabel } from "@/lib/utils";
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  StatCard,
  StatusBadge,
  useToast,
} from "@/components/ui";
import type { AttendanceRecord, AttendanceSummary, Employee, LeaveBalance, LeaveRequest } from "@/lib/types";

interface PortalData {
  hasEmployeeRecord: boolean;
  date: string;
  employee: Employee | null;
  today: AttendanceRecord | null;
  nextPunchDirection: "in" | "out";
  monthSummary: AttendanceSummary;
  leaveBalances: LeaveBalance[];
  pendingLeave: LeaveRequest[];
  upcomingHolidays: Array<{ _id: string; name: string; date: string }>;
}

export default function PortalHomePage() {
  const { session, can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();

  const locale = session?.organization?.locale || "en-IN";
  const timezone = session?.organization?.timezone;

  const { data, isLoading } = useQuery({
    queryKey: ["portal", "home"],
    queryFn: async () => {
      const { data: payload } = await api.get<PortalData>("/dashboard/me");
      return payload;
    },
  });

  const punch = useMutation({
    mutationFn: async (direction: "in" | "out") => {
      const position = await getPosition();
      const { data: result } = await api.post<{ duplicate: boolean }>("/attendance/punch", {
        direction,
        location: position,
      });
      return { ...result, direction };
    },
    onSuccess: (result) => {
      if (result.duplicate) {
        toast.info("Already recorded", "That punch was registered a moment ago.");
      } else {
        toast.success(
          result.direction === "in" ? "Checked in" : "Checked out",
          `Recorded at ${formatTime(new Date(), { locale, timezone })}.`
        );
      }
      queryClient.invalidateQueries({ queryKey: ["portal"] });
    },
    onError: (error) => toast.fromError(error, "Could not record your punch."),
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="skeleton h-28" />
        ))}
      </div>
    );
  }

  if (!data?.hasEmployeeRecord) {
    return (
      <EmptyState
        title="Your account is not linked to an employee record"
        description="Ask your HR team to connect your login to your employee profile so you can see attendance, leave and payslips."
      />
    );
  }

  const today = data.today;
  const canPunch = can("attendance.punch");

  return (
    <>
      <PageHeader
        title={`Hello, ${session?.user.firstName || "there"}`}
        description={`${formatDate(data.date, { locale })} · ${refLabel(data.employee?.employment.designationId, "")}`}
      />

      {/* ── Punch card ───────────────────────────────────────────────── */}
      {canPunch && (
        <Card className="mb-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[12px] font-medium uppercase tracking-wide text-[var(--text-subtle)]">
                Today
              </p>
              <div className="mt-1 flex flex-wrap items-baseline gap-3">
                <span className="tabular text-2xl font-semibold text-[var(--text)]">
                  {today?.firstPunchAt ? formatTime(today.firstPunchAt, { locale, timezone }) : "—"}
                </span>
                <span className="text-[var(--text-subtle)]">→</span>
                <span className="tabular text-2xl font-semibold text-[var(--text)]">
                  {today?.lastPunchAt ? formatTime(today.lastPunchAt, { locale, timezone }) : "—"}
                </span>
                {today && <StatusBadge status={today.status} />}
              </div>
              <p className="mt-1 text-[13px] text-[var(--text-muted)]">
                {today?.effectiveMinutes
                  ? `${formatMinutes(today.effectiveMinutes)} worked so far`
                  : "No punches recorded yet today"}
                {today?.isLate && ` · marked late by ${today.lateByMinutes} minutes`}
              </p>
            </div>

            <Button
              size="lg"
              variant={data.nextPunchDirection === "in" ? "primary" : "outline"}
              loading={punch.isPending}
              onClick={() => punch.mutate(data.nextPunchDirection)}
              icon={
                data.nextPunchDirection === "in" ? (
                  <LogIn className="h-4.5 w-4.5" />
                ) : (
                  <LogOut className="h-4.5 w-4.5" />
                )
              }
            >
              {data.nextPunchDirection === "in" ? "Check in" : "Check out"}
            </Button>
          </div>
        </Card>
      )}

      {/* ── This month ───────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Present this month"
          value={data.monthSummary.present}
          hint={`${data.monthSummary.payableDays} payable days`}
          icon={<Clock className="h-5 w-5" />}
          tone="success"
        />
        <StatCard
          label="Hours worked"
          value={data.monthSummary.workedHours}
          hint={data.monthSummary.overtimeHours ? `${data.monthSummary.overtimeHours} overtime` : undefined}
          tone="info"
        />
        <StatCard
          label="Late marks"
          value={data.monthSummary.late}
          hint={data.monthSummary.missingPunch ? `${data.monthSummary.missingPunch} missing punches` : undefined}
          tone={data.monthSummary.late > 2 ? "warning" : "default"}
        />
        <StatCard
          label="Leave taken"
          value={data.monthSummary.leave}
          hint={`${data.monthSummary.absent} absent`}
          icon={<CalendarDays className="h-5 w-5" />}
        />
      </div>

      {/* ── Balances and requests ────────────────────────────────────── */}
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Leave balance"
            action={
              <Link
                href="/me/leave"
                className="text-[12.5px] font-medium text-brand-600 hover:underline"
              >
                Apply for leave
              </Link>
            }
          />

          {!data.leaveBalances.length ? (
            <p className="mt-4 text-[13px] text-[var(--text-muted)]">
              No leave types are available to you yet.
            </p>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.leaveBalances.map((balance) => (
                <div key={balance.leaveType.id} className="rounded-[var(--radius)] border p-3.5">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ background: balance.leaveType.colour }}
                      aria-hidden
                    />
                    <p className="truncate text-[13px] font-medium text-[var(--text)]">
                      {balance.leaveType.name}
                    </p>
                  </div>
                  <p className="tabular mt-1.5 text-xl font-semibold text-[var(--text)]">
                    {balance.available ?? 0}
                  </p>
                  <p className="text-[12px] text-[var(--text-muted)]">
                    days left
                    {Boolean(balance.pending) && ` · ${balance.pending} pending`}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Your requests" />
            {!data.pendingLeave.length ? (
              <p className="mt-4 text-[13px] text-[var(--text-muted)]">
                Nothing waiting for approval.
              </p>
            ) : (
              <ul className="mt-3 space-y-2.5">
                {data.pendingLeave.map((request) => {
                  const type = typeof request.leaveTypeId === "object" ? request.leaveTypeId : null;
                  return (
                    <li key={request.id} className="flex items-start gap-2.5">
                      <span
                        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                        style={{ background: type?.colour || "var(--border-strong)" }}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-[var(--text)]">
                          {type?.name || "Leave"} · {request.leaveDays} days
                        </p>
                        <p className="text-[12px] text-[var(--text-muted)]">
                          {formatDate(request.fromDate, { locale })}
                          {request.fromDate !== request.toDate &&
                            ` → ${formatDate(request.toDate, { locale })}`}
                        </p>
                      </div>
                      <StatusBadge status={request.status} />
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Upcoming holidays" />
            {!data.upcomingHolidays.length ? (
              <p className="mt-4 text-[13px] text-[var(--text-muted)]">
                No holidays coming up.
              </p>
            ) : (
              <ul className="mt-3 space-y-2.5">
                {data.upcomingHolidays.map((holiday) => (
                  <li key={holiday._id} className="flex items-center gap-2.5">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-violet-50 text-violet-600">
                      <PartyPopper className="h-4 w-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-[var(--text)]">
                        {holiday.name}
                      </p>
                      <p className="text-[12px] text-[var(--text-muted)]">
                        {formatDate(holiday.date, { locale })}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {/* ── Quick links ──────────────────────────────────────────────── */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { href: "/me/attendance", label: "My attendance", icon: Clock },
          { href: "/me/leave", label: "Apply for leave", icon: CalendarDays },
          { href: "/me/payslips", label: "My payslips", icon: Wallet },
          { href: "/me/documents", label: "My documents", icon: FileText },
        ].map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="group card flex items-center gap-3 p-4 transition-colors hover:border-brand-300"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
              <link.icon className="h-4.5 w-4.5" aria-hidden />
            </span>
            <span className="flex-1 text-[13.5px] font-medium text-[var(--text)]">{link.label}</span>
            <ArrowRight
              className="h-4 w-4 text-[var(--text-subtle)] transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </Link>
        ))}
      </div>
    </>
  );
}

/**
 * Best-effort location for a web check-in.
 *
 * Never blocks the punch: if the browser refuses, times out, or the employee
 * declines the prompt, the punch still goes through without coordinates. An
 * attendance system that fails to record someone's arrival because a GPS fix
 * was slow is worse than one that records it without a location.
 */
async function getPosition(): Promise<{ latitude: number; longitude: number; accuracy: number } | undefined> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return undefined;

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), 4000);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(timer);
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      },
      { timeout: 4000, maximumAge: 60_000 }
    );
  });
}
