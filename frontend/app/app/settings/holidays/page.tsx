"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, PartyPopper, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatDate, humanise } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  Input,
  Modal,
  NoAccessState,
  PageHeader,
  PageLoader,
  Select,
  Textarea,
  useToast,
} from "@/components/ui";

interface Calendar {
  _id: string;
  name: string;
  code: string;
  year: number;
  isDefault: boolean;
  optionalHolidayQuota: number;
  holidayCount: number;
}

interface Holiday {
  _id: string;
  name: string;
  date: string;
  type: string;
  isOptional: boolean;
  colour: string;
}

export default function HolidaysSettingsPage() {
  const { session, can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const locale = session?.organization?.locale || "en-IN";

  const year = new Date().getFullYear();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creatingCalendar, setCreatingCalendar] = useState(false);
  const [addingHoliday, setAddingHoliday] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  const { data: calendars, isLoading } = useQuery({
    queryKey: ["holiday-calendars"],
    queryFn: async () => {
      const { data } = await api.get<Calendar[]>("/holidays/calendars");
      return data;
    },
    enabled: can("holiday.view"),
  });

  const active = calendars?.find((c) => c._id === selectedId) || calendars?.[0] || null;

  const { data: holidays } = useQuery({
    queryKey: ["holidays", active?._id],
    queryFn: async () => {
      const { data } = await api.get<Holiday[]>("/holidays", {
        query: { calendarId: active!._id },
      });
      return data;
    },
    enabled: Boolean(active),
  });

  const removeHoliday = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/holidays/${id}`);
    },
    onSuccess: () => {
      toast.success("Holiday removed");
      queryClient.invalidateQueries({ queryKey: ["holidays"] });
    },
    onError: (error) => toast.fromError(error, "Could not remove that holiday."),
  });

  if (!can("holiday.view")) return <NoAccessState what="holiday calendars" />;
  if (isLoading) return <PageLoader label="Loading calendars" />;

  const canManage = can("holiday.manage");

  return (
    <>
      <PageHeader
        title="Holidays"
        description="Different locations can follow different calendars, which is what makes a company with offices in two states work correctly."
        actions={
          canManage && (
            <>
              <Button variant="outline" onClick={() => setCreatingCalendar(true)} icon={<Plus className="h-4 w-4" />}>
                New calendar
              </Button>
              {active && (
                <Button onClick={() => setBulkOpen(true)} icon={<CalendarPlus className="h-4 w-4" />}>
                  Paste a year&apos;s list
                </Button>
              )}
            </>
          )
        }
      />

      {!calendars?.length ? (
        <Card>
          <EmptyState
            icon={<PartyPopper className="h-6 w-6" />}
            title="No holiday calendars yet"
            description="Create a calendar for the year, then add the holidays. You can have several — one per state or country."
            action={
              canManage ? (
                <Button onClick={() => setCreatingCalendar(true)} icon={<Plus className="h-4 w-4" />}>
                  Create a calendar
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap gap-2">
            {calendars.map((calendar) => (
              <button
                key={calendar._id}
                type="button"
                onClick={() => setSelectedId(calendar._id)}
                className={
                  calendar._id === active?._id
                    ? "rounded-[calc(var(--radius)-2px)] border border-brand-400 bg-brand-50 px-3 py-1.5 text-[13px] font-medium text-brand-700"
                    : "rounded-[calc(var(--radius)-2px)] border px-3 py-1.5 text-[13px] text-[var(--text-muted)] hover:bg-[var(--surface-muted)]"
                }
              >
                {calendar.name}
                <span className="ml-1.5 text-[11px] text-[var(--text-subtle)]">
                  {calendar.holidayCount}
                </span>
              </button>
            ))}
          </div>

          {active && (
            <Card padded={false}>
              <div className="flex items-center justify-between p-5 pb-3">
                <CardHeader
                  title={`${active.name} · ${active.year}`}
                  description={
                    active.optionalHolidayQuota > 0
                      ? `Employees may choose ${active.optionalHolidayQuota} optional holidays from the list.`
                      : undefined
                  }
                />
                {canManage && (
                  <Button size="sm" onClick={() => setAddingHoliday(true)} icon={<Plus className="h-3.5 w-3.5" />}>
                    Add holiday
                  </Button>
                )}
              </div>

              {!holidays?.length ? (
                <EmptyState
                  title="No holidays in this calendar"
                  description="Add them one at a time, or paste the whole year's list at once."
                />
              ) : (
                <ul className="divide-y">
                  {holidays.map((holiday) => (
                    <li key={holiday._id} className="flex items-center gap-3 px-5 py-3">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: holiday.colour }}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-medium text-[var(--text)]">{holiday.name}</p>
                        <p className="text-[12.5px] text-[var(--text-muted)]">
                          {formatDate(holiday.date, { locale })} · {humanise(holiday.type)}
                        </p>
                      </div>

                      {holiday.isOptional && <Badge tone="purple">Optional</Badge>}

                      {canManage && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Remove holiday"
                          onClick={() => removeHoliday.mutate(holiday._id)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-[var(--danger)]" aria-hidden />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </>
      )}

      <CalendarDialog
        open={creatingCalendar}
        year={year}
        onClose={() => setCreatingCalendar(false)}
        onDone={() => {
          setCreatingCalendar(false);
          queryClient.invalidateQueries({ queryKey: ["holiday-calendars"] });
        }}
      />

      {active && (
        <>
          <HolidayDialog
            open={addingHoliday}
            calendarId={active._id}
            year={active.year}
            onClose={() => setAddingHoliday(false)}
            onDone={() => {
              setAddingHoliday(false);
              queryClient.invalidateQueries({ queryKey: ["holidays"] });
              queryClient.invalidateQueries({ queryKey: ["holiday-calendars"] });
            }}
          />

          <BulkDialog
            open={bulkOpen}
            calendarId={active._id}
            year={active.year}
            onClose={() => setBulkOpen(false)}
            onDone={() => {
              setBulkOpen(false);
              queryClient.invalidateQueries({ queryKey: ["holidays"] });
              queryClient.invalidateQueries({ queryKey: ["holiday-calendars"] });
            }}
          />
        </>
      )}
    </>
  );
}

function CalendarDialog({
  open,
  year,
  onClose,
  onDone,
}: {
  open: boolean;
  year: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({ name: "", code: "", year, optionalHolidayQuota: 0, isDefault: false });

  const create = useMutation({
    mutationFn: async () => {
      await api.post("/holidays/calendars", form);
    },
    onSuccess: () => {
      toast.success("Calendar created");
      onDone();
    },
    onError: (error) => toast.fromError(error, "Could not create that calendar."),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New holiday calendar"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={create.isPending} disabled={!form.name || !form.code} onClick={() => create.mutate()}>
            Create
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Name"
          required
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          placeholder="Kerala 2026"
        />
        <Input
          label="Code"
          required
          value={form.code}
          onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })}
          placeholder="KL"
        />
        <Input
          label="Year"
          type="number"
          value={form.year}
          onChange={(event) => setForm({ ...form, year: Number(event.target.value) })}
        />
        <Input
          label="Optional holidays employees may choose"
          type="number"
          min={0}
          max={20}
          value={form.optionalHolidayQuota}
          onChange={(event) => setForm({ ...form, optionalHolidayQuota: Number(event.target.value) })}
          hint="0 turns restricted holidays off."
        />
      </div>
    </Modal>
  );
}

function HolidayDialog({
  open,
  calendarId,
  year,
  onClose,
  onDone,
}: {
  open: boolean;
  calendarId: string;
  year: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({ name: "", date: `${year}-01-01`, type: "public", isOptional: false });

  const create = useMutation({
    mutationFn: async () => {
      await api.post("/holidays", { ...form, calendarId });
    },
    onSuccess: () => {
      toast.success("Holiday added");
      setForm({ name: "", date: `${year}-01-01`, type: "public", isOptional: false });
      onDone();
    },
    onError: (error) => toast.fromError(error, "Could not add that holiday."),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a holiday"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={create.isPending} disabled={!form.name} onClick={() => create.mutate()}>
            Add
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Name"
          required
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          placeholder="Independence Day"
        />
        <div>
          <label className="block text-[13px] font-medium text-[var(--text)]">Date</label>
          <input
            type="date"
            value={form.date}
            onChange={(event) => setForm({ ...form, date: event.target.value })}
            className="input-base mt-1.5"
          />
        </div>
        <Select
          label="Type"
          value={form.type}
          onChange={(event) => setForm({ ...form, type: event.target.value })}
          options={["public", "national", "regional", "company", "restricted"].map((value) => ({
            value,
            label: humanise(value),
          }))}
        />
        <label className="flex items-center gap-2.5">
          <input
            type="checkbox"
            checked={form.isOptional}
            onChange={(event) => setForm({ ...form, isOptional: event.target.checked })}
            className="h-4 w-4 rounded border-[var(--border-strong)] accent-[var(--brand-600)]"
          />
          <span className="text-[13.5px]">
            Optional — employees choose whether to take it
          </span>
        </label>
      </div>
    </Modal>
  );
}

function BulkDialog({
  open,
  calendarId,
  year,
  onClose,
  onDone,
}: {
  open: boolean;
  calendarId: string;
  year: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [text, setText] = useState("");

  const parsed = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [date, ...nameParts] = line.split(/[,\t]/);
      return { date: (date || "").trim(), name: nameParts.join(",").trim(), type: "public" };
    })
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && row.name);

  const create = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ added: number; skipped: Array<{ reason: string }> }>(
        "/holidays/bulk",
        { calendarId, holidays: parsed }
      );
      return data;
    },
    onSuccess: (result) => {
      toast.success(
        `${result.added} holidays added`,
        result.skipped.length ? `${result.skipped.length} rows were skipped.` : undefined
      );
      setText("");
      onDone();
    },
    onError: (error) => toast.fromError(error, "Could not add those holidays."),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Paste a year's holiday list"
      description="One per line, as date then name."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={create.isPending} disabled={!parsed.length} onClick={() => create.mutate()}>
            Add {parsed.length} {parsed.length === 1 ? "holiday" : "holidays"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Callout tone="info">
          Format: <code className="font-mono">YYYY-MM-DD, Holiday name</code> — one per line. Dates
          outside {year} and dates already in the calendar are skipped and reported.
        </Callout>

        <Textarea
          label="Holidays"
          rows={10}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={`${year}-01-26, Republic Day\n${year}-08-15, Independence Day\n${year}-10-02, Gandhi Jayanti`}
          className="font-mono text-[13px]"
        />

        {text && (
          <p className="text-[12.5px] text-[var(--text-muted)]">
            {parsed.length} valid {parsed.length === 1 ? "line" : "lines"} recognised.
          </p>
        )}
      </div>
    </Modal>
  );
}
