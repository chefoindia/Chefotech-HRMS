"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Banknote,
  CalendarDays,
  Clock,
  FileText,
  History,
  Mail,
  MapPin,
  Phone,
  Send,
  ShieldAlert,
  UserCog,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatDate, formatDays, formatRelative, humanise } from "@/lib/format";
import { refLabel } from "@/lib/utils";
import { EmployeeDocumentsPanel } from "@/components/documents/EmployeeDocumentsPanel";
import { EmployeeChangesPanel } from "@/components/modules/EmployeeChangesPanel";
import { EmployeeAssetsTab } from "@/components/modules/EmployeeAssetsTab";
import {
  Avatar,
  Button,
  Callout,
  Card,
  CardHeader,
  ConfirmDialog,
  DetailGrid,
  DetailItem,
  EmptyState,
  ErrorState,
  Modal,
  PageHeader,
  PageLoader,
  Select,
  StatusBadge,
  Tabs,
  Textarea,
  useToast,
} from "@/components/ui";
import type { AttendanceSummary, Employee, LeaveBalance } from "@/lib/types";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "personal", label: "Personal" },
  { key: "employment", label: "Employment" },
  { key: "attendance", label: "Attendance" },
  { key: "leave", label: "Leave" },
  { key: "documents", label: "Documents" },
  { key: "movements", label: "Movements" },
  { key: "assets", label: "Assets" },
  { key: "activity", label: "Activity" },
];

export default function EmployeeProfilePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { session, can } = useSession();
  const locale = session?.organization?.locale || "en-IN";

  const [tab, setTab] = useState("overview");
  const [statusOpen, setStatusOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  const employeeId = params.id;

  const { data: employee, isLoading, error, refetch } = useQuery({
    queryKey: ["employee", employeeId],
    queryFn: async () => {
      const { data } = await api.get<Employee>(`/employees/${employeeId}`);
      return data;
    },
  });

  const invite = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ email: string; roleName: string }>(
        `/employees/${employeeId}/invite`,
        {}
      );
      return data;
    },
    onSuccess: (result) => {
      toast.success("Invitation sent", `${result.email} can now set a password.`);
      setInviteOpen(false);
      queryClient.invalidateQueries({ queryKey: ["employee", employeeId] });
    },
    onError: (err) => toast.fromError(err, "Could not send the invitation."),
  });

  if (isLoading) return <PageLoader label="Loading profile" />;

  if (error) {
    const isNotFound = error instanceof ApiError && error.status === 404;
    return (
      <ErrorState
        title={isNotFound ? "Employee not found" : "Could not load this profile"}
        description={
          isNotFound
            ? "This employee does not exist, or is outside what your role can see."
            : (error as Error).message
        }
        onRetry={isNotFound ? undefined : refetch}
      />
    );
  }

  if (!employee) return null;

  const isEmployed = ["active", "on_leave", "notice_period", "suspended"].includes(employee.status);

  return (
    <>
      <PageHeader
        title={employee.fullName}
        breadcrumb={
          <Link
            href="/app/employees"
            className="mb-2 inline-flex items-center gap-1.5 text-[13px] text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Employees
          </Link>
        }
        actions={
          <>
            {can("user.invite") && !employee.personal.workEmail && (
              <span className="text-[12.5px] text-[var(--text-subtle)]">
                Add a work email to invite them
              </span>
            )}
            {can("user.invite") && employee.personal.workEmail && (
              <Button
                variant="outline"
                icon={<Send className="h-4 w-4" />}
                onClick={() => setInviteOpen(true)}
              >
                Invite to portal
              </Button>
            )}
            {can("employee.update") && (
              <Button
                variant="outline"
                icon={<UserCog className="h-4 w-4" />}
                onClick={() => setStatusOpen(true)}
              >
                Change status
              </Button>
            )}
            {can("employee.update") && (
              <Button onClick={() => router.push(`/app/employees/${employeeId}/edit`)}>Edit</Button>
            )}
          </>
        }
      />

      {/* ── Identity card ────────────────────────────────────────────── */}
      <Card className="mb-5">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <Avatar src={employee.avatarUrl} name={employee.fullName} size="xl" />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-[var(--text)]">{employee.fullName}</h2>
              <StatusBadge status={employee.status} />
            </div>

            <p className="mt-0.5 text-[14px] text-[var(--text-muted)]">
              {refLabel(employee.employment.designationId, "No designation")}
              {employee.employment.departmentId && ` · ${refLabel(employee.employment.departmentId)}`}
            </p>

            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-[var(--text-muted)]">
              <span className="inline-flex items-center gap-1.5">
                <span className="font-mono text-[12px]">{employee.employeeCode}</span>
              </span>
              {employee.personal.workEmail && (
                <a
                  href={`mailto:${employee.personal.workEmail}`}
                  className="inline-flex items-center gap-1.5 hover:text-brand-600"
                >
                  <Mail className="h-3.5 w-3.5" aria-hidden />
                  {employee.personal.workEmail}
                </a>
              )}
              {employee.personal.phone && (
                <a
                  href={`tel:${employee.personal.phone}`}
                  className="inline-flex items-center gap-1.5 hover:text-brand-600"
                >
                  <Phone className="h-3.5 w-3.5" aria-hidden />
                  {employee.personal.phone}
                </a>
              )}
              {employee.employment.locationId && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" aria-hidden />
                  {refLabel(employee.employment.locationId)}
                </span>
              )}
            </div>
          </div>

          <div className="shrink-0 sm:text-right">
            <p className="text-[12px] uppercase tracking-wide text-[var(--text-subtle)]">Joined</p>
            <p className="text-[14px] font-medium text-[var(--text)]">
              {formatDate(employee.employment.joiningDate, { locale })}
            </p>
            {employee.employment.managerId && (
              <>
                <p className="mt-2 text-[12px] uppercase tracking-wide text-[var(--text-subtle)]">
                  Reports to
                </p>
                <p className="text-[13.5px] text-[var(--text)]">
                  {refLabel(employee.employment.managerId)}
                </p>
              </>
            )}
          </div>
        </div>
      </Card>

      {employee.sensitiveHidden && (
        <Callout tone="info" className="mb-5" icon={<ShieldAlert className="h-4 w-4" />}>
          Bank, statutory and identity details are hidden. They need the{" "}
          <strong>view sensitive data</strong> permission.
        </Callout>
      )}

      <Tabs items={TABS} active={tab} onChange={setTab} className="mb-5" />

      {tab === "overview" && <OverviewTab employee={employee} locale={locale} />}
      {tab === "personal" && <PersonalTab employee={employee} locale={locale} />}
      {tab === "employment" && <EmploymentTab employee={employee} locale={locale} />}
      {tab === "attendance" && <AttendanceTab employeeId={employeeId} />}
      {tab === "leave" && <LeaveTab employeeId={employeeId} />}
      {tab === "documents" && <DocumentsTab employeeId={employeeId} locale={locale} />}
      {tab === "movements" && <EmployeeChangesPanel employeeId={employeeId} locale={locale} />}
      {tab === "assets" && <EmployeeAssetsTab employeeId={employeeId} locale={locale} />}
      {tab === "activity" && <ActivityTab employeeId={employeeId} />}

      <StatusDialog
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
        employee={employee}
        onDone={() => {
          setStatusOpen(false);
          queryClient.invalidateQueries({ queryKey: ["employee", employeeId] });
        }}
      />

      <ConfirmDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onConfirm={() => invite.mutate()}
        loading={invite.isPending}
        title="Invite to the employee portal"
        confirmLabel="Send invitation"
        message={
          <>
            We will email <strong>{employee.personal.workEmail}</strong> a link to set their own
            password. They will be able to see their attendance, apply for leave and download
            payslips.
          </>
        }
      />
    </>
  );
}

// ── Tabs ────────────────────────────────────────────────────────────────────

function OverviewTab({ employee, locale }: { employee: Employee; locale: string }) {
  const { data: attendance } = useQuery({
    queryKey: ["employee", employee.id, "attendance-summary"],
    queryFn: async () => {
      const now = new Date();
      const { data } = await api.get<{ summary: AttendanceSummary }>(
        `/attendance/employee/${employee.id}`,
        { query: { year: now.getFullYear(), month: now.getMonth() + 1 } }
      );
      return data.summary;
    },
  });

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="This month" description="Attendance so far in the current month." />
        {!attendance ? (
          <div className="skeleton mt-4 h-20" />
        ) : (
          <DetailGrid columns={4} className="mt-4">
            <DetailItem label="Present" value={attendance.present} />
            <DetailItem label="Absent" value={attendance.absent} />
            <DetailItem label="Half days" value={attendance.halfDay} />
            <DetailItem label="On leave" value={attendance.leave} />
            <DetailItem label="Late marks" value={attendance.late} />
            <DetailItem label="Missing punches" value={attendance.missingPunch} />
            <DetailItem label="Hours worked" value={attendance.workedHours} />
            <DetailItem label="Payable days" value={attendance.payableDays} />
          </DetailGrid>
        )}
      </Card>

      <Card>
        <CardHeader title="Emergency contacts" />
        {!employee.personal.emergencyContacts?.length ? (
          <p className="mt-4 text-[13px] text-[var(--text-muted)]">None recorded.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {employee.personal.emergencyContacts.map((contact, index) => (
              <li key={index}>
                <p className="text-[13.5px] font-medium text-[var(--text)]">
                  {contact.name}
                  {contact.isPrimary && (
                    <span className="ml-1.5 text-[11px] text-[var(--text-subtle)]">primary</span>
                  )}
                </p>
                <p className="text-[12.5px] text-[var(--text-muted)]">
                  {contact.relationship}
                  {contact.phone && ` · ${contact.phone}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function PersonalTab({ employee, locale }: { employee: Employee; locale: string }) {
  const address = employee.personal.currentAddress || {};

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Personal details" />
        <DetailGrid className="mt-4">
          <DetailItem label="Full name" value={employee.fullName} />
          <DetailItem label="Gender" value={humanise(employee.personal.gender)} />
          <DetailItem
            label="Date of birth"
            value={formatDate(employee.personal.dateOfBirth, { locale })}
          />
          <DetailItem label="Blood group" value={employee.personal.bloodGroup || "—"} />
          <DetailItem label="Marital status" value={humanise(employee.personal.maritalStatus)} />
          <DetailItem label="Personal email" value={employee.personal.personalEmail || "—"} />
          <DetailItem label="Phone" value={employee.personal.phone || "—"} />
          <DetailItem label="Alternate phone" value={employee.personal.alternatePhone || "—"} />
          <DetailItem
            label="Current address"
            value={
              [address.line1, address.city, address.state, address.postalCode]
                .filter(Boolean)
                .join(", ") || "—"
            }
          />
        </DetailGrid>
      </Card>

      {employee.bank && (
        <Card>
          <CardHeader
            title="Bank details"
            description="Used for salary payment."
            action={<Banknote className="h-4.5 w-4.5 text-[var(--text-subtle)]" />}
          />
          <DetailGrid className="mt-4">
            <DetailItem label="Account holder" value={employee.bank.accountHolderName || "—"} />
            <DetailItem
              label="Account number"
              value={
                employee.bank.accountNumber
                  ? `•••• ${employee.bank.accountNumber.slice(-4)}`
                  : "—"
              }
            />
            <DetailItem label="Bank" value={employee.bank.bankName || "—"} />
            <DetailItem label="IFSC" value={employee.bank.ifscCode || "—"} />
          </DetailGrid>
        </Card>
      )}

      {employee.statutory && (
        <Card>
          <CardHeader title="Statutory" />
          <DetailGrid className="mt-4">
            <DetailItem label="PF number" value={String(employee.statutory.pfNumber || "—")} />
            <DetailItem label="UAN" value={String(employee.statutory.uan || "—")} />
            <DetailItem label="ESI number" value={String(employee.statutory.esiNumber || "—")} />
            <DetailItem
              label="Tax ID"
              value={employee.statutory.taxId ? "•••• (recorded)" : "—"}
            />
          </DetailGrid>
        </Card>
      )}
    </div>
  );
}

function EmploymentTab({ employee, locale }: { employee: Employee; locale: string }) {
  return (
    <Card>
      <CardHeader title="Employment" />
      <DetailGrid className="mt-4">
        <DetailItem label="Employee code" value={employee.employeeCode} />
        <DetailItem label="Biometric ID" value={employee.biometricId || "Not enrolled"} />
        <DetailItem label="Department" value={refLabel(employee.employment.departmentId)} />
        <DetailItem label="Designation" value={refLabel(employee.employment.designationId)} />
        <DetailItem label="Location" value={refLabel(employee.employment.locationId)} />
        <DetailItem label="Manager" value={refLabel(employee.employment.managerId)} />
        <DetailItem
          label="Employment type"
          value={humanise(employee.employment.employmentType)}
        />
        <DetailItem label="Work mode" value={humanise(employee.employment.workMode)} />
        <DetailItem
          label="Joining date"
          value={formatDate(employee.employment.joiningDate, { locale })}
        />
        <DetailItem
          label="Confirmation date"
          value={formatDate(employee.employment.confirmationDate, { locale })}
        />
        <DetailItem
          label="Notice period"
          value={
            employee.employment.noticePeriodDays
              ? `${employee.employment.noticePeriodDays} days`
              : "Organization default"
          }
        />
        <DetailItem
          label="Attendance"
          value={employee.employment.isAttendanceExempt ? "Exempt" : "Tracked"}
        />
      </DetailGrid>
    </Card>
  );
}

function AttendanceTab({ employeeId }: { employeeId: string }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const { data, isLoading } = useQuery({
    queryKey: ["employee", employeeId, "attendance", year, month],
    queryFn: async () => {
      const { data: payload } = await api.get<{
        days: Array<{ date: string; status: string; effectiveMinutes: number; isLate: boolean }>;
        summary: AttendanceSummary;
      }>(`/attendance/employee/${employeeId}`, { query: { year, month } });
      return payload;
    },
  });

  return (
    <Card>
      <CardHeader
        title="Attendance"
        action={
          <div className="flex gap-2">
            <Select
              value={String(month)}
              onChange={(event) => setMonth(Number(event.target.value))}
              options={Array.from({ length: 12 }, (_, index) => ({
                value: index + 1,
                label: new Date(2000, index, 1).toLocaleString("en", { month: "long" }),
              }))}
              className="h-8 py-0 text-[13px]"
            />
            <Select
              value={String(year)}
              onChange={(event) => setYear(Number(event.target.value))}
              options={[now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2].map((y) => ({
                value: y,
                label: String(y),
              }))}
              className="h-8 py-0 text-[13px]"
            />
          </div>
        }
      />

      {isLoading ? (
        <div className="skeleton mt-4 h-40" />
      ) : (
        <>
          <DetailGrid columns={4} className="mt-4">
            <DetailItem label="Present" value={data?.summary.present ?? 0} />
            <DetailItem label="Absent" value={data?.summary.absent ?? 0} />
            <DetailItem label="Leave" value={data?.summary.leave ?? 0} />
            <DetailItem label="Payable days" value={data?.summary.payableDays ?? 0} />
          </DetailGrid>

          <div className="mt-5 flex flex-wrap gap-1">
            {data?.days.map((day) => (
              <div
                key={day.date}
                title={`${day.date} · ${humanise(day.status)}`}
                className="grid h-9 w-9 place-items-center rounded text-[11px] font-medium"
                style={{ background: statusColour(day.status), color: statusTextColour(day.status) }}
              >
                {day.date.slice(-2)}
              </div>
            ))}
          </div>

          <Link
            href={`/app/attendance/monthly?employeeId=${employeeId}`}
            className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-600 hover:underline"
          >
            <Clock className="h-3.5 w-3.5" aria-hidden />
            Open the full attendance view
          </Link>
        </>
      )}
    </Card>
  );
}

function LeaveTab({ employeeId }: { employeeId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["employee", employeeId, "leave-balances"],
    queryFn: async () => {
      const { data: balances } = await api.get<LeaveBalance[]>(`/leave/balances/${employeeId}`);
      return balances;
    },
  });

  if (isLoading) return <div className="skeleton h-40" />;

  const withBalance = (data || []).filter((balance) => balance.hasBalance);

  return (
    <Card>
      <CardHeader title="Leave balances" description="For the current leave year." />

      {!withBalance.length ? (
        <EmptyState
          icon={<CalendarDays className="h-5 w-5" />}
          title="No leave balances"
          description="Assign a leave policy to this employee to see their entitlement."
        />
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {withBalance.map((balance) => (
            <div key={balance.leaveType.id} className="rounded-[var(--radius)] border p-3.5">
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: balance.leaveType.colour }}
                  aria-hidden
                />
                <p className="text-[13.5px] font-medium text-[var(--text)]">
                  {balance.leaveType.name}
                </p>
              </div>

              <p className="tabular mt-2 text-2xl font-semibold text-[var(--text)]">
                {balance.available ?? 0}
              </p>
              <p className="text-[12px] text-[var(--text-muted)]">days available</p>

              <dl className="mt-3 space-y-0.5 border-t pt-2 text-[12px]">
                <div className="flex justify-between">
                  <dt className="text-[var(--text-muted)]">Allocated</dt>
                  <dd className="tabular">{balance.allocated ?? 0}</dd>
                </div>
                {Boolean(balance.carriedForward) && (
                  <div className="flex justify-between">
                    <dt className="text-[var(--text-muted)]">Carried forward</dt>
                    <dd className="tabular">{balance.carriedForward}</dd>
                  </div>
                )}
                <div className="flex justify-between">
                  <dt className="text-[var(--text-muted)]">Used</dt>
                  <dd className="tabular">{balance.used ?? 0}</dd>
                </div>
                {Boolean(balance.pending) && (
                  <div className="flex justify-between">
                    <dt className="text-[var(--text-muted)]">Pending approval</dt>
                    <dd className="tabular">{balance.pending}</dd>
                  </div>
                )}
              </dl>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function DocumentsTab({ employeeId, locale }: { employeeId: string; locale: string }) {
  return <EmployeeDocumentsPanel employeeId={employeeId} locale={locale} />;
}

function ActivityTab({ employeeId }: { employeeId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["employee", employeeId, "activity"],
    queryFn: async () => {
      const { data: entries } = await api.get<
        Array<{
          _id: string;
          action: string;
          actorName: string | null;
          description: string | null;
          changedFields: string[];
          severity: string;
          occurredAt: string;
        }>
      >(`/employees/${employeeId}/activity`);
      return entries;
    },
  });

  if (isLoading) return <div className="skeleton h-40" />;

  return (
    <Card>
      <CardHeader
        title="Activity"
        description="Every change to this record, and who made it."
      />

      {!data?.length ? (
        <EmptyState
          icon={<History className="h-5 w-5" />}
          title="No activity recorded"
        />
      ) : (
        <ol className="mt-4 space-y-4">
          {data.map((entry) => (
            <li key={entry._id} className="flex gap-3">
              <span
                className={
                  entry.severity === "critical"
                    ? "mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--danger)]"
                    : entry.severity === "warning"
                      ? "mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--warning)]"
                      : "mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--border-strong)]"
                }
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] text-[var(--text)]">
                  {entry.description || humanise(entry.action.split(".").pop() || entry.action)}
                </p>
                <p className="text-[12px] text-[var(--text-muted)]">
                  {entry.actorName || "System"} · {formatRelative(entry.occurredAt)}
                  {entry.changedFields.length > 0 &&
                    ` · changed ${entry.changedFields.slice(0, 4).join(", ")}`}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

// ── Status change ───────────────────────────────────────────────────────────

function StatusDialog({
  open,
  onClose,
  employee,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  employee: Employee;
  onDone: () => void;
}) {
  const toast = useToast();
  const [status, setStatus] = useState("");
  const [reason, setReason] = useState("");
  const [lastWorkingDay, setLastWorkingDay] = useState("");

  const isExit = ["resigned", "terminated", "inactive"].includes(status);

  const change = useMutation({
    mutationFn: async () => {
      await api.post(`/employees/${employee.id}/status`, {
        status,
        reason,
        ...(isExit && lastWorkingDay
          ? { exit: { lastWorkingDay, exitType: status === "resigned" ? "resignation" : "termination" } }
          : {}),
      });
    },
    onSuccess: () => {
      toast.success("Status updated", `${employee.fullName} is now ${humanise(status)}.`);
      onDone();
      setStatus("");
      setReason("");
    },
    onError: (error) => toast.fromError(error, "Could not change the status."),
  });

  const options = (
    {
      draft: ["invited", "active", "inactive"],
      invited: ["active", "inactive"],
      active: ["on_leave", "suspended", "notice_period", "resigned", "terminated", "inactive"],
      on_leave: ["active", "suspended", "notice_period", "resigned", "terminated"],
      suspended: ["active", "terminated", "inactive"],
      notice_period: ["resigned", "terminated", "active"],
      resigned: ["inactive", "active"],
      terminated: ["inactive", "active"],
      inactive: ["active"],
    } as Record<string, string[]>
  )[employee.status] || [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Change employment status"
      description={`${employee.fullName} is currently ${humanise(employee.status)}.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => change.mutate()}
            loading={change.isPending}
            disabled={!status || !reason.trim()}
          >
            Update status
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Select
          label="New status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          options={options.map((value) => ({ value, label: humanise(value) }))}
          placeholder="Choose a status"
          hint="Only transitions that make sense from the current status are offered."
        />

        {isExit && (
          <>
            <Callout tone="warning">
              Marking someone as {humanise(status)} suspends their portal access and stops
              attendance being calculated after their last working day. Their history is kept.
            </Callout>
            <input
              type="date"
              value={lastWorkingDay}
              onChange={(event) => setLastWorkingDay(event.target.value)}
              aria-label="Last working day"
              className="input-base"
            />
          </>
        )}

        <Textarea
          label="Reason"
          required
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Recorded in the audit trail"
          rows={3}
        />
      </div>
    </Modal>
  );
}

function statusColour(status: string) {
  return (
    {
      present: "var(--success-bg)",
      absent: "var(--danger-bg)",
      half_day: "var(--warning-bg)",
      leave: "var(--info-bg)",
      holiday: "#f5f3ff",
      weekly_off: "var(--surface-sunken)",
      pending: "var(--surface-sunken)",
    }[status] || "var(--surface-sunken)"
  );
}

function statusTextColour(status: string) {
  return (
    {
      present: "var(--success)",
      absent: "var(--danger)",
      half_day: "var(--warning)",
      leave: "var(--info)",
      holiday: "#7c3aed",
    }[status] || "var(--text-subtle)"
  );
}
