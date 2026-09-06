"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Pause, Play, Plus, Send, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { Badge, Button, Callout, EmptyState, FieldGrid, Input, Modal, Select, Textarea, useToast } from "@/components/ui";
import { SCHEDULE_PERIODS, WEEKDAYS, describeSchedule, type SchedulePeriod, type SheetFilters, type SheetSchedule, type SheetSource, type SheetTemplate } from "@/lib/documentTemplateTypes";
import { SheetFilterFields } from "./SheetFilters";

/**
 * "Email this sheet to accounts on the 2nd of every month."
 *
 * A schedule is the sheet plus a relative period plus recipients. The
 * period is relative ("last month") so the same schedule keeps working;
 * fixed filters (a department, a location) come from the sheet or are set
 * here. What gets sent is decided by the permissions of whoever created the
 * schedule, so it can never widen what its author could see.
 */
export function SheetScheduleDialog({ sheet, source, onClose }: { sheet: Pick<SheetTemplate, "id" | "name" | "source" | "filters">; source?: SheetSource; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);

  const { data: schedules, isLoading } = useQuery({
    queryKey: ["sheets", "schedules", sheet.id],
    queryFn: async () => {
      const { data } = await api.get<SheetSchedule[]>("/sheets/schedules", { query: { sheetId: sheet.id } });
      return data;
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["sheets", "schedules", sheet.id] });

  const runNow = useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post<{ rows: number; recipients: number }>(`/sheets/schedules/${id}/run`);
      return data;
    },
    onSuccess: (data) => {
      toast.success("Sent", `${data.rows} rows to ${data.recipients} recipient${data.recipients === 1 ? "" : "s"}.`);
      invalidate();
    },
    onError: (error) => {
      toast.fromError(error, "The sheet could not be sent.");
      invalidate();
    },
  });

  const toggle = useMutation({
    mutationFn: async (s: SheetSchedule) => api.patch(`/sheets/schedules/${s.id}`, { isActive: !s.isActive }),
    onSuccess: () => invalidate(),
    onError: (error) => toast.fromError(error, "Could not update the schedule."),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/sheets/schedules/${id}`),
    onSuccess: () => {
      toast.success("Schedule removed");
      invalidate();
    },
    onError: (error) => toast.fromError(error, "Could not remove the schedule."),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Schedule: ${sheet.name}`}
      description="Email this sheet automatically. Times are in your organization's time zone."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {!adding && (
            <Button icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAdding(true)}>
              New schedule
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-5">
        {adding ? (
          <ScheduleForm
            sheet={sheet}
            source={source}
            onDone={() => {
              setAdding(false);
              invalidate();
            }}
            onCancel={() => setAdding(false)}
          />
        ) : null}

        {isLoading ? (
          <p className="text-[13px] text-[var(--text-muted)]">Loading schedules…</p>
        ) : !schedules || schedules.length === 0 ? (
          !adding && (
            <EmptyState
              icon={<CalendarClock className="h-5 w-5" />}
              title="No schedules yet"
              description="Add one and this sheet will render itself and land in someone's inbox on time, every time."
              action={
                <Button icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAdding(true)}>
                  New schedule
                </Button>
              }
            />
          )
        ) : (
          <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
            {schedules.map((s) => (
              <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[13.5px] font-medium text-[var(--text)]">{s.name}</p>
                    {!s.isActive && <Badge tone="neutral">Paused</Badge>}
                    {s.lastRunStatus === "ok" && <Badge tone="success">Last run ok</Badge>}
                    {s.lastRunStatus === "failed" && <Badge tone="danger">Last run failed</Badge>}
                  </div>
                  <p className="mt-0.5 text-[12.5px] text-[var(--text-muted)]">
                    {describeSchedule(s)} · {SCHEDULE_PERIODS.find((p) => p.value === s.period)?.label || s.period} · {s.format.toUpperCase()}
                  </p>
                  <p className="mt-0.5 truncate text-[12.5px] text-[var(--text-muted)]">To: {s.recipients.join(", ")}</p>
                  {s.lastRunAt && (
                    <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">
                      Last run {formatRelative(s.lastRunAt)}
                      {s.lastError && <span className="text-[var(--danger)]"> — {s.lastError}</span>}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="sm" icon={<Send className="h-3.5 w-3.5" />} loading={runNow.isPending && runNow.variables === s.id} onClick={() => runNow.mutate(s.id)}>
                    Send now
                  </Button>
                  <Button variant="ghost" size="sm" icon={s.isActive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />} onClick={() => toggle.mutate(s)}>
                    {s.isActive ? "Pause" : "Resume"}
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="Remove schedule" onClick={() => remove.mutate(s.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

function ScheduleForm({ sheet, source, onDone, onCancel }: { sheet: Pick<SheetTemplate, "id" | "name" | "source" | "filters">; source?: SheetSource; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const periods = useMemo(() => {
    if (source?.requiresRun) return SCHEDULE_PERIODS.filter((p) => p.value === "last_payroll_run");
    if (source?.requiresDateRange) return SCHEDULE_PERIODS.filter((p) => p.value !== "none" && p.value !== "last_payroll_run");
    return SCHEDULE_PERIODS.filter((p) => p.value !== "last_payroll_run");
  }, [source]);

  const [name, setName] = useState(`${sheet.name}`);
  const [frequency, setFrequency] = useState<"daily" | "weekly" | "monthly">(source?.requiresRun ? "monthly" : "weekly");
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(source?.requiresRun ? 2 : 1);
  const [hour, setHour] = useState(8);
  const [period, setPeriod] = useState<SchedulePeriod>(periods[0].value);
  const [format, setFormat] = useState<"xlsx" | "csv" | "pdf">("xlsx");
  const [recipientsText, setRecipientsText] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [filters, setFilters] = useState<SheetFilters>(() => {
    const base = { ...(sheet.filters || {}) } as SheetFilters;
    delete base.fromDate;
    delete base.toDate;
    delete base.runId;
    delete base.employeeIds;
    return base;
  });

  const fixedKeys = (source?.filters || []).filter((k) => !["fromDate", "toDate", "runId", "employeeIds"].includes(k));
  const recipients = recipientsText
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const invalidRecipient = recipients.find((r) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r));

  const create = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<SheetSchedule>("/sheets/schedules", {
        sheetId: sheet.id,
        name: name.trim(),
        frequency,
        dayOfWeek,
        dayOfMonth,
        hour,
        period,
        format,
        filters,
        recipients,
        subject: subject.trim(),
        message: message.trim(),
      });
      return data;
    },
    onSuccess: () => {
      toast.success("Scheduled", `${describeSchedule({ frequency, dayOfWeek, dayOfMonth, hour })}.`);
      onDone();
    },
    onError: (error) => toast.fromError(error, "Could not create the schedule."),
  });

  const canSubmit = name.trim().length > 0 && recipients.length > 0 && !invalidRecipient;

  return (
    <div className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-4">
      <FieldGrid columns={2}>
        <Input label="Schedule name" value={name} onChange={(e) => setName(e.target.value)} required />
        <Select
          label="Format"
          value={format}
          onChange={(e) => setFormat(e.target.value as typeof format)}
          options={[
            { value: "xlsx", label: "Excel workbook (.xlsx)" },
            { value: "csv", label: "CSV" },
            { value: "pdf", label: "PDF" },
          ]}
        />
      </FieldGrid>

      <FieldGrid columns={3}>
        <Select
          label="How often"
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as typeof frequency)}
          options={[
            { value: "daily", label: "Every day" },
            { value: "weekly", label: "Every week" },
            { value: "monthly", label: "Every month" },
          ]}
        />
        {frequency === "weekly" && <Select label="On" value={String(dayOfWeek)} onChange={(e) => setDayOfWeek(Number(e.target.value))} options={WEEKDAYS.map((d, i) => ({ value: String(i), label: d }))} />}
        {frequency === "monthly" && (
          <Select label="On day" value={String(dayOfMonth)} onChange={(e) => setDayOfMonth(Number(e.target.value))} options={Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))} hint="1 to 28, so it exists in every month." />
        )}
        <Select label="At" value={String(hour)} onChange={(e) => setHour(Number(e.target.value))} options={Array.from({ length: 24 }, (_, i) => ({ value: String(i), label: `${String(i).padStart(2, "0")}:00` }))} />
      </FieldGrid>

      <Select label="Data period" value={period} onChange={(e) => setPeriod(e.target.value as SchedulePeriod)} options={periods.map((p) => ({ value: p.value, label: p.label }))} hint="Worked out fresh each time it runs." />

      {fixedKeys.length > 0 && <SheetFilterFields keys={fixedKeys} value={filters} onChange={setFilters} columns={3} />}

      <Textarea
        label="Send to"
        rows={2}
        value={recipientsText}
        onChange={(e) => setRecipientsText(e.target.value)}
        placeholder="accounts@company.com, plant.head@company.com"
        hint={invalidRecipient ? `"${invalidRecipient}" is not an email address.` : "Separate addresses with commas. Anyone, including people outside the platform."}
        required
      />
      <FieldGrid columns={2}>
        <Input label="Subject (optional)" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={`${sheet.name} — last month`} />
        <Input label="Message (optional)" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="A line above the attachment." />
      </FieldGrid>

      <Callout tone="info">The sheet is rendered with your permissions each time. If your access changes, what is sent changes with it.</Callout>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button icon={<CalendarClock className="h-3.5 w-3.5" />} disabled={!canSubmit} loading={create.isPending} onClick={() => create.mutate()}>
          Create schedule
        </Button>
      </div>
    </div>
  );
}
