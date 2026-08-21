"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, ChevronRight, Info } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatDate, formatMinutes, formatTime, humanise, monthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Button,
  Callout,
  Card,
  CardHeader,
  DetailGrid,
  DetailItem,
  Modal,
  PageHeader,
  Select,
  StatusBadge,
  Textarea,
  useToast,
} from "@/components/ui";
import type { AttendanceRecord, AttendanceSummary } from "@/lib/types";

/**
 * My attendance.
 *
 * A month at a time, with the calculation trail on every day. When someone
 * disputes a half day, the reason is right there — the rules that fired and
 * the values they used — rather than being something HR has to reconstruct.
 */
export default function MyAttendancePage() {
  const { session, can } = useSession();
  const locale = session?.organization?.locale || "en-IN";
  const timezone = session?.organization?.timezone;
  const queryClient = useQueryClient();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [inspecting, setInspecting] = useState<AttendanceRecord | null>(null);
  const [correcting, setCorrecting] = useState<AttendanceRecord | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["me", "attendance", year, month],
    queryFn: async () => {
      const { data: payload } = await api.get<{
        days: AttendanceRecord[];
        summary: AttendanceSummary;
      }>("/attendance/me", { query: { year, month } });
      return payload;
    },
  });

  const shift = (delta: number) => {
    const next = new Date(year, month - 1 + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth() + 1);
  };

  const summary = data?.summary;

  return (
    <>
      <PageHeader
        title="My attendance"
        description="Every day this month, and exactly how each one was worked out."
        actions={
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" onClick={() => shift(-1)} aria-label="Previous month">
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </Button>
            <span className="min-w-40 text-center text-[14px] font-medium text-[var(--text)]">
              {monthLabel(year, month, locale)}
            </span>
            <Button
              variant="outline"
              size="icon"
              onClick={() => shift(1)}
              aria-label="Next month"
              disabled={year === now.getFullYear() && month === now.getMonth() + 1}
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        }
      />

      {summary && (
        <Card className="mb-5">
          <DetailGrid columns={4}>
            <DetailItem label="Present" value={summary.present} />
            <DetailItem label="Half days" value={summary.halfDay} />
            <DetailItem label="Absent" value={summary.absent} />
            <DetailItem label="On leave" value={summary.leave} />
            <DetailItem label="Late marks" value={summary.late} />
            <DetailItem label="Missing punches" value={summary.missingPunch} />
            <DetailItem label="Hours worked" value={summary.workedHours} />
            <DetailItem label="Payable days" value={summary.payableDays} />
          </DetailGrid>
        </Card>
      )}

      <Card padded={false}>
        <div className="p-5 pb-3">
          <CardHeader
            title="Daily record"
            description="Select any day to see how it was calculated."
          />
        </div>

        {isLoading ? (
          <div className="space-y-2 p-5">
            {[0, 1, 2, 3, 4].map((index) => (
              <div key={index} className="skeleton h-10" />
            ))}
          </div>
        ) : (
          <ul className="divide-y">
            {data?.days.map((day) => {
              const isFuture = day.date > new Date().toISOString().slice(0, 10);

              return (
                <li
                  key={day.date}
                  className={cn(
                    "flex flex-wrap items-center gap-3 px-5 py-3",
                    !isFuture && "cursor-pointer hover:bg-[var(--surface-muted)]"
                  )}
                  onClick={() => !isFuture && setInspecting(day)}
                >
                  <div className="w-16 shrink-0">
                    <p className="tabular text-[13.5px] font-medium text-[var(--text)]">
                      {day.date.slice(-2)}
                    </p>
                    <p className="text-[11.5px] text-[var(--text-subtle)]">
                      {new Date(day.date).toLocaleDateString(locale, { weekday: "short" })}
                    </p>
                  </div>

                  <div className="w-32 shrink-0">
                    <StatusBadge status={day.status} />
                  </div>

                  <div className="tabular hidden w-40 shrink-0 text-[13px] text-[var(--text-muted)] sm:block">
                    {day.firstPunchAt ? formatTime(day.firstPunchAt, { locale, timezone }) : "—"}
                    {" → "}
                    {day.lastPunchAt ? formatTime(day.lastPunchAt, { locale, timezone }) : "—"}
                  </div>

                  <div className="hidden w-24 shrink-0 text-[13px] text-[var(--text-muted)] md:block">
                    {day.effectiveMinutes ? formatMinutes(day.effectiveMinutes) : "—"}
                  </div>

                  <div className="min-w-0 flex-1 text-right">
                    {day.isLate && (
                      <span className="mr-2 text-[12px] text-[var(--warning)]">
                        Late {day.lateByMinutes}m
                      </span>
                    )}
                    {day.isMissingPunch && (
                      <span className="mr-2 inline-flex items-center gap-1 text-[12px] text-[var(--warning)]">
                        <AlertTriangle className="h-3 w-3" aria-hidden />
                        Missing punch
                      </span>
                    )}
                    {day.holidayName && (
                      <span className="text-[12px] text-violet-600">{day.holidayName}</span>
                    )}
                    {day.leaveType && (
                      <span className="text-[12px] text-[var(--info)]">{day.leaveType}</span>
                    )}
                  </div>

                  {can("attendance.correct") && !isFuture && !day.isLocked && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        setCorrecting(day);
                      }}
                    >
                      Request correction
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* ── Why was this day calculated like this? ─────────────────── */}
      {inspecting && (
        <Modal
          open
          onClose={() => setInspecting(null)}
          title={formatDate(inspecting.date, { locale })}
          description="How this day was calculated."
          size="md"
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge status={inspecting.status} />
              <span className="text-[13px] text-[var(--text-muted)]">
                {inspecting.payableDays} payable {inspecting.payableDays === 1 ? "day" : "days"}
              </span>
              {inspecting.isLocked && (
                <span className="text-[12.5px] text-[var(--text-subtle)]">Locked for payroll</span>
              )}
            </div>

            {inspecting.punches && inspecting.punches.length > 0 && (
              <div>
                <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
                  Punches
                </p>
                <ul className="space-y-1">
                  {inspecting.punches.map((punch, index) => (
                    <li key={index} className="flex items-center gap-2 text-[13px]">
                      <span className="tabular font-medium">
                        {formatTime(punch.at, { locale, timezone })}
                      </span>
                      <span className="text-[var(--text-muted)]">
                        {punch.direction ? humanise(punch.direction) : "—"} · {humanise(punch.source)}
                        {punch.isManual && " · added manually"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
                Rules applied
              </p>
              {!inspecting.breakdown?.length ? (
                <p className="text-[13px] text-[var(--text-muted)]">
                  No calculation trail for this day.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {inspecting.breakdown.map((entry, index) => (
                    <li key={index} className="flex gap-3 text-[13px]">
                      <span className="min-w-0 flex-1 text-[var(--text-muted)]">{entry.detail}</span>
                      <span className="shrink-0 font-medium text-[var(--text)]">{entry.effect}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {inspecting.isManualOverride && (
              <Callout tone="info" icon={<Info className="h-4 w-4" />}>
                This day was set manually by HR, so the punch rules were not applied.
              </Callout>
            )}
          </div>
        </Modal>
      )}

      {correcting && (
        <CorrectionDialog
          record={correcting}
          locale={locale}
          onClose={() => setCorrecting(null)}
          onDone={() => {
            setCorrecting(null);
            queryClient.invalidateQueries({ queryKey: ["me"] });
          }}
        />
      )}
    </>
  );
}

function CorrectionDialog({
  record,
  locale,
  onClose,
  onDone,
}: {
  record: AttendanceRecord;
  locale: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    type: record.isMissingPunch ? "missing_punch" : "forgot_to_punch",
    checkIn: "",
    checkOut: "",
    reason: "",
  });

  const submit = useMutation({
    mutationFn: async () => {
      await api.post("/attendance/me/corrections", {
        date: record.date,
        type: form.type,
        requested: {
          checkIn: form.checkIn || null,
          checkOut: form.checkOut || null,
        },
        reason: form.reason,
      });
    },
    onSuccess: () => {
      toast.success("Correction requested", "Your manager has been notified.");
      onDone();
    },
    onError: (error) => toast.fromError(error, "Could not raise that request."),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Request a correction"
      description={formatDate(record.date, { locale })}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={submit.isPending}
            disabled={form.reason.trim().length < 5}
            onClick={() => submit.mutate()}
          >
            Send request
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Select
          label="What happened?"
          value={form.type}
          onChange={(event) => setForm({ ...form, type: event.target.value })}
          options={[
            { value: "missing_punch", label: "A punch is missing" },
            { value: "forgot_to_punch", label: "I forgot to punch" },
            { value: "wrong_punch", label: "The recorded time is wrong" },
            { value: "on_duty", label: "I was on duty elsewhere" },
            { value: "work_from_home", label: "I worked from home" },
          ]}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-[13px] font-medium text-[var(--text)]">
              Check in should be
            </label>
            <input
              type="time"
              value={form.checkIn}
              onChange={(event) => setForm({ ...form, checkIn: event.target.value })}
              className="input-base mt-1.5"
            />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-[var(--text)]">
              Check out should be
            </label>
            <input
              type="time"
              value={form.checkOut}
              onChange={(event) => setForm({ ...form, checkOut: event.target.value })}
              className="input-base mt-1.5"
            />
          </div>
        </div>

        <Textarea
          label="Reason"
          required
          rows={3}
          value={form.reason}
          onChange={(event) => setForm({ ...form, reason: event.target.value })}
          placeholder="Your manager reads this, so give them enough to approve it."
          hint="At least a few words."
        />
      </div>
    </Modal>
  );
}
