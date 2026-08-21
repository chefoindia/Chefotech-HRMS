"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useReferenceData, toOptions } from "@/lib/hooks";
import { monthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Button,
  Card,
  FilterSelect,
  NoAccessState,
  PageHeader,
} from "@/components/ui";

interface CalendarData {
  fromDate: string;
  toDate: string;
  byDate: Record<
    string,
    Array<{
      employeeId: string;
      employeeCode: string;
      name: string;
      leaveType: string;
      colour: string;
      portion: string;
      status: string;
    }>
  >;
}

/**
 * The team leave calendar.
 *
 * The question this answers is "can I approve this, or will the team be
 * empty that week" — so it shows the whole month at once with everyone on it,
 * rather than one person at a time.
 */
export default function LeaveCalendarPage() {
  const { session, canAny } = useSession();
  const locale = session?.organization?.locale || "en-IN";

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [departmentId, setDepartmentId] = useState("");

  const reference = useReferenceData();

  const fromDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const toDate = new Date(year, month, 0).toISOString().slice(0, 10);

  const { data, isLoading } = useQuery({
    queryKey: ["leave", "calendar", fromDate, toDate, departmentId],
    queryFn: async () => {
      const { data: payload } = await api.get<CalendarData>("/leave/calendar", {
        query: { fromDate, toDate, departmentId: departmentId || undefined },
      });
      return payload;
    },
  });

  const shift = (delta: number) => {
    const next = new Date(year, month - 1 + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth() + 1);
  };

  if (!canAny("leave.view", "leave.view_team", "leave.apply")) {
    return <NoAccessState what="the leave calendar" />;
  }

  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const cells: Array<string | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => {
      return `${year}-${String(month).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`;
    }),
  ];

  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        title="Leave calendar"
        description="Who is off, and when — so you can see the gaps before approving."
        actions={
          <>
            <FilterSelect
              value={departmentId}
              onChange={setDepartmentId}
              options={toOptions(reference.departments)}
              placeholder="All departments"
            />
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" onClick={() => shift(-1)} aria-label="Previous month">
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </Button>
              <span className="min-w-36 text-center text-[14px] font-medium">
                {monthLabel(year, month, locale)}
              </span>
              <Button variant="outline" size="icon" onClick={() => shift(1)} aria-label="Next month">
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          </>
        }
      />

      <Card padded={false}>
        <div className="grid grid-cols-7 border-b">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <div
              key={day}
              className="px-2 py-2 text-center text-[11.5px] font-semibold uppercase tracking-wide text-[var(--text-muted)]"
            >
              {day}
            </div>
          ))}
        </div>

        {isLoading ? (
          <div className="grid grid-cols-7">
            {Array.from({ length: 35 }).map((_, index) => (
              <div key={index} className="h-28 border-b border-r p-2">
                <div className="skeleton h-4 w-6" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-7">
            {cells.map((date, index) => {
              const people = date ? data?.byDate[date] || [] : [];
              const isWeekend = index % 7 === 0 || index % 7 === 6;

              return (
                <div
                  key={index}
                  className={cn(
                    "min-h-28 border-b border-r p-2 last:border-r-0",
                    isWeekend && "bg-[var(--surface-muted)]",
                    date === today && "bg-brand-50"
                  )}
                >
                  {date && (
                    <>
                      <p
                        className={cn(
                          "tabular mb-1 text-[12px]",
                          date === today
                            ? "font-semibold text-brand-700"
                            : "text-[var(--text-muted)]"
                        )}
                      >
                        {Number(date.slice(-2))}
                      </p>

                      <div className="space-y-0.5">
                        {people.slice(0, 3).map((person) => (
                          <div
                            key={`${person.employeeId}-${date}`}
                            title={`${person.name} · ${person.leaveType}${
                              person.status === "pending" ? " (pending)" : ""
                            }`}
                            className={cn(
                              "truncate rounded px-1.5 py-0.5 text-[11px]",
                              person.status === "pending" && "opacity-60"
                            )}
                            style={{
                              background: `${person.colour}22`,
                              color: person.colour,
                              borderLeft: `2px solid ${person.colour}`,
                            }}
                          >
                            {person.name.split(" ")[0]}
                            {person.portion !== "full" && " ½"}
                          </div>
                        ))}

                        {people.length > 3 && (
                          <p className="px-1.5 text-[11px] text-[var(--text-subtle)]">
                            +{people.length - 3} more
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <p className="mt-3 text-[12.5px] text-[var(--text-muted)]">
        Faded entries are requests still awaiting approval. A ½ marks a half day.
      </p>
    </>
  );
}
