"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, PartyPopper } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge, Button, Card, CardHeader, Checkbox, EmptyState, PageHeader, PageLoader, Select, useToast } from "@/components/ui";

interface HolidayRow {
  _id?: string;
  id?: string;
  name: string;
  date: string;
  description?: string;
  isOptional?: boolean;
  selected?: boolean;
}

interface HolidayCalendar {
  calendarId: string | null;
  calendarName?: string | null;
  quota: number;
  holidays: HolidayRow[];
  optional: HolidayRow[];
  selected: string[];
}

/**
 * The holiday calendar: every holiday for the year, the optional ones you
 * may choose within your quota, and a calendar file to subscribe with.
 * The same screen as the mobile app's Holidays.
 */
export default function MyHolidaysPage() {
  const { session } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const locale = session?.organization?.locale || "en-IN";
  const [year, setYear] = useState(new Date().getFullYear());
  const [chosen, setChosen] = useState<string[] | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["me", "holidays", year],
    queryFn: async () => (await api.get<HolidayCalendar>("/holidays/me", { query: { year } })).data,
  });

  const save = useMutation({
    mutationFn: async (holidayIds: string[]) => api.post("/holidays/me/optional", { year, holidayIds }),
    onSuccess: () => {
      toast.success("Optional holidays saved");
      setChosen(null);
      queryClient.invalidateQueries({ queryKey: ["me", "holidays"] });
    },
    onError: (error) => toast.fromError(error, "Could not save your choice."),
  });

  const download = async () => {
    try {
      await api.download("/holidays/me/calendar.ics", undefined, `holidays-${year}.ics`);
    } catch (error) {
      toast.fromError(error, "Could not prepare the calendar file.");
    }
  };

  const idOf = (h: HolidayRow) => String(h._id || h.id);
  const selected = chosen ?? (data?.selected || []);
  const today = new Date().toISOString().slice(0, 10);
  const all = [...(data?.holidays || []), ...(data?.optional || []).map((h) => ({ ...h, isOptional: true }))].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <>
      <PageHeader
        title="Holidays"
        description="Your holiday calendar for the year, and the optional days you can choose."
        actions={
          <div className="flex items-center gap-2">
            <Select value={String(year)} onChange={(e) => setYear(Number(e.target.value))} options={[year - 1, year, year + 1].map((y) => ({ value: String(y), label: String(y) }))} aria-label="Year" />
            <Button variant="outline" icon={<CalendarPlus className="h-4 w-4" />} onClick={download}>
              Add to my calendar
            </Button>
          </div>
        }
      />

      {isLoading || !data ? (
        <PageLoader label="Loading holidays" />
      ) : all.length === 0 ? (
        <Card>
          <EmptyState icon={<PartyPopper className="h-6 w-6" />} title="No holidays listed" description="Your employer has not published a holiday calendar for your location yet." />
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card className="lg:col-span-2" padded={false}>
            <div className="p-5 pb-3">
              <CardHeader title={data.calendarName || "Holiday calendar"} description={`${data.holidays.length} fixed holiday${data.holidays.length === 1 ? "" : "s"}${data.optional.length ? ` and ${data.optional.length} optional` : ""}.`} />
            </div>
            <ul className="divide-y">
              {all.map((holiday) => {
                const past = holiday.date < today;
                return (
                  <li key={idOf(holiday)} className={cn("flex items-center gap-4 px-5 py-3", past && "opacity-60")}>
                    <div className="w-14 shrink-0 rounded-md bg-violet-50 py-1.5 text-center text-violet-700">
                      <p className="text-[11px] font-semibold uppercase">{new Date(holiday.date).toLocaleDateString(locale, { month: "short" })}</p>
                      <p className="text-[18px] font-semibold leading-tight">{holiday.date.slice(-2)}</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-medium text-[var(--text)]">{holiday.name}</p>
                      <p className="text-[12.5px] text-[var(--text-muted)]">
                        {new Date(holiday.date).toLocaleDateString(locale, { weekday: "long" })}
                        {holiday.description ? ` · ${holiday.description}` : ""}
                      </p>
                    </div>
                    {holiday.isOptional && (selected.includes(idOf(holiday)) ? <Badge tone="success">Chosen</Badge> : <Badge tone="info">Optional</Badge>)}
                  </li>
                );
              })}
            </ul>
          </Card>

          {data.optional.length > 0 && (
            <Card>
              <CardHeader title="Optional holidays" description={`Choose up to ${data.quota} for ${year}.`} />
              <div className="mt-4 space-y-2">
                {data.optional.map((holiday) => {
                  const id = idOf(holiday);
                  const on = selected.includes(id);
                  return (
                    <Checkbox
                      key={id}
                      label={holiday.name}
                      hint={formatDate(holiday.date, { locale })}
                      checked={on}
                      disabled={!on && selected.length >= data.quota}
                      onChange={() => setChosen(on ? selected.filter((s) => s !== id) : [...selected, id])}
                    />
                  );
                })}
              </div>
              <p className="mt-3 text-[12.5px] text-[var(--text-muted)]">
                {selected.length} of {data.quota} chosen.
              </p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" loading={save.isPending} disabled={chosen === null} onClick={() => save.mutate(selected)}>
                  Save choice
                </Button>
                {chosen !== null && (
                  <Button size="sm" variant="ghost" onClick={() => setChosen(null)}>
                    Reset
                  </Button>
                )}
              </div>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
