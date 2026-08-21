"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowRight,
  Cake,
  CalendarDays,
  CheckCircle2,
  Clock,
  PartyPopper,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { colorForIndex } from "@/lib/theme";
import { formatDate, formatRelative } from "@/lib/format";
import {
  Avatar,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  StatCard,
  StatusBadge,
} from "@/components/ui";

interface DashboardData {
  scope: "organization" | "self";
  date: string;
  attendance: {
    totalEmployees: number;
    present: number;
    absent: number;
    onLeave: number;
    late: number;
    notMarked: number;
    attendancePercent: number;
  } | null;
  headcount: { total: number; active: number; byDepartment: Array<{ name: string; count: number }> } | null;
  pendingApprovals: { leave: number; attendanceCorrections: number; overtime?: number; total: number } | null;
  upcoming: {
    joiners: Array<{ _id: string; employeeCode: string; personal: { firstName: string; lastName: string }; employment: { joiningDate: string; designationId?: { name: string } } }>;
    birthdays: Array<{ _id: string; employeeCode: string; name: string; date: string }>;
    anniversaries: Array<{ _id: string; name: string; date: string; years: number }>;
    holidays: Array<{ _id: string; name: string; date: string }>;
    exits: Array<{ _id: string; employeeCode: string; personal: { firstName: string; lastName: string }; exit: { lastWorkingDay: string } }>;
  } | null;
  trend: Array<{ date: string; present: number; absent: number; leave: number; attendancePercent: number | null }> | null;
  departmentSplit: Array<{ name: string; count: number }> | null;
  onLeaveToday: Array<{ employeeId: string; name: string; leaveType: string; colour: string; portion: string }> | null;
}

export default function DashboardPage() {
  const { session } = useSession();
  const locale = session?.organization?.locale || "en-IN";

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const { data: payload } = await api.get<DashboardData>("/dashboard");
      return payload;
    },
    refetchInterval: 5 * 60_000,
  });

  const attendance = data?.attendance;
  const greeting = getGreeting();

  return (
    <>
      <PageHeader
        title={`${greeting}, ${session?.user.firstName || "there"}`}
        description={
          data?.date
            ? `Here is how ${session?.organization?.name || "your organization"} looks on ${formatDate(data.date, { locale })}.`
            : undefined
        }
      />

      {/* ── Today ────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Present today"
          value={attendance ? `${attendance.present}/${attendance.totalEmployees}` : "—"}
          hint={attendance ? `${attendance.attendancePercent}% attendance` : undefined}
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="success"
          loading={isLoading}
        />
        <StatCard
          label="On leave"
          value={attendance?.onLeave ?? "—"}
          hint={attendance?.notMarked ? `${attendance.notMarked} not marked yet` : undefined}
          icon={<CalendarDays className="h-5 w-5" />}
          tone="info"
          loading={isLoading}
        />
        <StatCard
          label="Late today"
          value={attendance?.late ?? "—"}
          hint={attendance?.absent ? `${attendance.absent} absent` : undefined}
          icon={<Clock className="h-5 w-5" />}
          tone="warning"
          loading={isLoading}
        />
        <StatCard
          label="Pending approvals"
          value={data?.pendingApprovals?.total ?? 0}
          hint={
            data?.pendingApprovals
              ? [
                  `${data.pendingApprovals.leave} leave`,
                  `${data.pendingApprovals.attendanceCorrections} corrections`,
                  data.pendingApprovals.overtime
                    ? `${data.pendingApprovals.overtime} overtime`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : undefined
          }
          icon={<Users className="h-5 w-5" />}
          tone={data?.pendingApprovals?.total ? "danger" : "default"}
          loading={isLoading}
          onClick={() => (window.location.href = "/app/approvals")}
        />
      </div>

      {/* ── Charts ───────────────────────────────────────────────────── */}
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Attendance over the last 30 days"
            description="Share of expected working days that were actually worked."
          />

          <div className="mt-4 h-64">
            {isLoading ? (
              <div className="skeleton h-full w-full" />
            ) : !data?.trend?.length ? (
              <EmptyState
                title="No attendance yet"
                description="Once punches start arriving, the trend appears here."
              />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.trend} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="attendanceFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--brand-500)" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="var(--brand-500)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: "var(--text-subtle)" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value: string) => value.slice(8)}
                    interval="preserveStartEnd"
                    minTickGap={20}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fontSize: 11, fill: "var(--text-subtle)" }}
                    tickLine={false}
                    axisLine={false}
                    width={40}
                    tickFormatter={(value: number) => `${value}%`}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      fontSize: 12,
                    }}
                    labelFormatter={(value: string) => formatDate(value, { locale })}
                    formatter={(value: number) => [`${value ?? 0}%`, "Attendance"]}
                  />
                  <Area
                    type="monotone"
                    dataKey="attendancePercent"
                    stroke="var(--brand-600)"
                    strokeWidth={2}
                    fill="url(#attendanceFill)"
                    connectNulls
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Headcount by department" />

          <div className="mt-4 h-64">
            {isLoading ? (
              <div className="skeleton h-full w-full" />
            ) : !data?.departmentSplit?.length ? (
              <EmptyState title="No departments yet" description="Add departments to see the split." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.departmentSplit}
                    dataKey="count"
                    nameKey="name"
                    innerRadius={52}
                    outerRadius={84}
                    paddingAngle={2}
                  >
                    {data.departmentSplit.map((_, index) => (
                      <Cell key={index} fill={colorForIndex(index)} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>

          {data?.departmentSplit && data.departmentSplit.length > 0 && (
            <ul className="mt-2 space-y-1">
              {data.departmentSplit.slice(0, 5).map((department, index) => (
                <li key={department.name} className="flex items-center gap-2 text-[12.5px]">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: colorForIndex(index) }}
                    aria-hidden
                  />
                  <span className="truncate text-[var(--text-muted)]">{department.name}</span>
                  <span className="tabular ml-auto font-medium text-[var(--text)]">
                    {department.count}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* ── People ───────────────────────────────────────────────────── */}
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader
            title="Who is off today"
            action={
              <Link
                href="/app/leave/calendar"
                className="text-[12.5px] font-medium text-brand-600 hover:underline"
              >
                Calendar
              </Link>
            }
          />

          <div className="mt-3 space-y-2">
            {isLoading ? (
              [0, 1, 2].map((index) => <div key={index} className="skeleton h-10" />)
            ) : !data?.onLeaveToday?.length ? (
              <p className="py-6 text-center text-[13px] text-[var(--text-muted)]">
                Everyone is in today.
              </p>
            ) : (
              data.onLeaveToday.slice(0, 6).map((person) => (
                <div key={person.employeeId} className="flex items-center gap-2.5">
                  <Avatar name={person.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-[var(--text)]">
                      {person.name}
                    </p>
                    <p className="truncate text-[12px] text-[var(--text-muted)]">
                      {person.leaveType}
                      {person.portion !== "full" && ` · ${person.portion.replace("_", " ")}`}
                    </p>
                  </div>
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: person.colour }}
                    aria-hidden
                  />
                </div>
              ))
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Joining soon" />
          <div className="mt-3 space-y-2.5">
            {!data?.upcoming?.joiners?.length ? (
              <p className="py-6 text-center text-[13px] text-[var(--text-muted)]">
                No one joining in the next 30 days.
              </p>
            ) : (
              data.upcoming.joiners.slice(0, 5).map((joiner) => {
                const name = [joiner.personal.firstName, joiner.personal.lastName]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <Link
                    key={joiner._id}
                    href={`/app/employees/${joiner._id}`}
                    className="flex items-center gap-2.5 rounded-md p-1 hover:bg-[var(--surface-muted)]"
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--success-bg)] text-[var(--success)]">
                      <UserPlus className="h-4 w-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-[var(--text)]">{name}</p>
                      <p className="truncate text-[12px] text-[var(--text-muted)]">
                        {joiner.employment.designationId?.name || joiner.employeeCode}
                      </p>
                    </div>
                    <span className="shrink-0 text-[12px] text-[var(--text-subtle)]">
                      {formatDate(joiner.employment.joiningDate, { locale, format: "DD MMM YYYY" })}
                    </span>
                  </Link>
                );
              })
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Coming up" />
          <div className="mt-3 space-y-2.5">
            {data?.upcoming?.holidays?.slice(0, 3).map((holiday) => (
              <div key={holiday._id} className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-violet-50 text-violet-600">
                  <PartyPopper className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-[var(--text)]">{holiday.name}</p>
                  <p className="text-[12px] text-[var(--text-muted)]">
                    {formatDate(holiday.date, { locale })}
                  </p>
                </div>
              </div>
            ))}

            {data?.upcoming?.birthdays?.slice(0, 3).map((birthday) => (
              <div key={birthday._id} className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-pink-50 text-pink-600">
                  <Cake className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-[var(--text)]">
                    {birthday.name}
                  </p>
                  <p className="text-[12px] text-[var(--text-muted)]">Birthday · {birthday.date}</p>
                </div>
              </div>
            ))}

            {data?.upcoming?.exits?.slice(0, 2).map((exit) => (
              <div key={exit._id} className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--warning-bg)] text-[var(--warning)]">
                  <UserMinus className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-[var(--text)]">
                    {[exit.personal.firstName, exit.personal.lastName].filter(Boolean).join(" ")}
                  </p>
                  <p className="text-[12px] text-[var(--text-muted)]">
                    Last day {formatDate(exit.exit.lastWorkingDay, { locale })}
                  </p>
                </div>
              </div>
            ))}

            {!data?.upcoming?.holidays?.length &&
              !data?.upcoming?.birthdays?.length &&
              !data?.upcoming?.exits?.length && (
                <p className="py-6 text-center text-[13px] text-[var(--text-muted)]">
                  Nothing in the next 30 days.
                </p>
              )}
          </div>
        </Card>
      </div>

      {/* ── Quick links ──────────────────────────────────────────────── */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { href: "/app/employees/new", label: "Add an employee", description: "Create a record and invite them" },
          { href: "/app/attendance", label: "Today's attendance", description: "Who is in, who is late" },
          { href: "/app/approvals", label: "Approvals", description: "Leave and corrections waiting on you" },
          { href: "/app/reports", label: "Run a report", description: "Attendance, leave, payroll" },
        ].map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="group card flex items-center gap-3 p-4 transition-colors hover:border-brand-300"
          >
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-medium text-[var(--text)]">{link.label}</p>
              <p className="truncate text-[12px] text-[var(--text-muted)]">{link.description}</p>
            </div>
            <ArrowRight
              className="h-4 w-4 shrink-0 text-[var(--text-subtle)] transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600"
              aria-hidden
            />
          </Link>
        ))}
      </div>
    </>
  );
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
