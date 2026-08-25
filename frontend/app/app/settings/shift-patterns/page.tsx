"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, Plus, Save, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  FieldGrid,
  FieldHelp,
  Input,
  NoAccessState,
  PageHeader,
  PageLoader,
  Select,
  Switch,
  useToast,
} from "@/components/ui";
import { SHIFT_PATTERN_HELP } from "@/content/settingsHelp";

interface Shift {
  id: string;
  name: string;
  code: string;
  startTime: string;
  endTime: string;
  colour: string;
}

interface PatternDay {
  day?: number;
  position?: number;
  shiftId: string | null;
}

interface ShiftPattern {
  id: string;
  name: string;
  code: string;
  description: string;
  type: "weekly" | "rotating";
  days: PatternDay[];
  cycle: PatternDay[];
  anchorDate: string | null;
  isActive: boolean;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function help(path: string, label: string) {
  const content = SHIFT_PATTERN_HELP[path];
  return content ? <FieldHelp label={label} help={content} /> : undefined;
}

/**
 * Shift patterns — a repeating roster, rather than one fixed shift per person.
 *
 * Two shapes cover essentially every real roster: fixed by weekday ("late
 * shift on Wednesdays"), or a rotation of any length anchored to a start date
 * ("three mornings, three nights, one off"). The preview underneath resolves
 * real dates through the same code the attendance engine uses, so what you see
 * here is exactly what will be used to judge someone's attendance.
 */
export default function ShiftPatternsPage() {
  const { can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ShiftPattern | null>(null);
  const [dirty, setDirty] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { data: patterns, isLoading } = useQuery({
    queryKey: ["shift-patterns"],
    queryFn: async () => (await api.get<ShiftPattern[]>("/shifts/patterns", { query: { limit: 100 } })).data,
  });

  const { data: shifts } = useQuery({
    queryKey: ["shifts", "all"],
    queryFn: async () => (await api.get<Shift[]>("/shifts", { query: { limit: 100 } })).data,
  });

  useEffect(() => {
    if (!patterns?.length) {
      setDraft(null);
      return;
    }
    const target = patterns.find((p) => p.id === selectedId) || patterns[0];
    setSelectedId(target.id);
    setDraft(structuredClone(target));
    setDirty(false);
  }, [patterns, selectedId]);

  const save = useMutation({
    mutationFn: async () => {
      if (!draft) return;
      await api.patch(`/shifts/patterns/${draft.id}`, {
        name: draft.name,
        description: draft.description,
        type: draft.type,
        days: draft.days,
        cycle: draft.cycle,
        anchorDate: draft.anchorDate,
        isActive: draft.isActive,
      });
    },
    onSuccess: () => {
      toast.success("Pattern saved", "New attendance is measured against this roster.");
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["shift-patterns"] });
    },
    onError: (error) => toast.fromError(error, "Could not save this pattern."),
  });

  const create = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<ShiftPattern>("/shifts/patterns", {
        name: "New pattern",
        code: `PAT${Date.now().toString().slice(-5)}`,
        type: "weekly",
        days: WEEKDAYS.map((_, day) => ({ day, shiftId: null })),
      });
      return data;
    },
    onSuccess: (pattern) => {
      toast.success("Pattern created");
      setSelectedId(pattern.id);
      queryClient.invalidateQueries({ queryKey: ["shift-patterns"] });
    },
    onError: (error) => toast.fromError(error, "Could not create a pattern."),
  });

  const remove = useMutation({
    mutationFn: async () => api.delete(`/shifts/patterns/${draft!.id}`),
    onSuccess: () => {
      toast.success("Pattern removed");
      setSelectedId(null);
      setDeleting(false);
      queryClient.invalidateQueries({ queryKey: ["shift-patterns"] });
    },
    onError: (error) => {
      toast.fromError(error, "Could not remove this pattern.");
      setDeleting(false);
    },
  });

  if (!can("shift.view")) return <NoAccessState what="shift patterns" />;
  if (isLoading) return <PageLoader label="Loading patterns" />;

  const canManage = can("shift.manage");
  const set = <K extends keyof ShiftPattern>(key: K, value: ShiftPattern[K]) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setDirty(true);
  };

  /**
   * Update a key from its own previous value.
   *
   * `set` computes the new value from the `draft` captured in this render, so
   * two clicks landing in the same batch both build on the same stale array
   * and the first one is lost. Anything appending to or editing a list has to
   * derive from the live state instead.
   */
  const update = <K extends keyof ShiftPattern>(
    key: K,
    producer: (previous: ShiftPattern[K]) => ShiftPattern[K]
  ) => {
    setDraft((current) => (current ? { ...current, [key]: producer(current[key]) } : current));
    setDirty(true);
  };

  const shiftOptions = [
    { value: "", label: "Day off" },
    ...(shifts || []).map((s) => ({ value: s.id, label: `${s.name} (${s.startTime}–${s.endTime})` })),
  ];

  if (!patterns?.length) {
    return (
      <>
        <PageHeader
          title="Shift patterns"
          description="For teams whose shift changes by day of the week, or rotates."
        />
        <Card>
          <EmptyState
            icon={<CalendarRange className="h-6 w-6" />}
            title="No shift patterns yet"
            description="Most people work one fixed shift and need nothing here. Create a pattern for anyone whose shift changes — a late shift on Wednesdays, or a morning/night rotation."
            action={
              canManage ? (
                <Button onClick={() => create.mutate()} loading={create.isPending} icon={<Plus className="h-4 w-4" />}>
                  Create a pattern
                </Button>
              ) : undefined
            }
          />
        </Card>
      </>
    );
  }

  if (!draft) return <PageLoader />;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Shift patterns"
        description="A repeating roster, applied to an employee instead of a single fixed shift."
        actions={
          canManage && (
            <>
              <Button variant="outline" onClick={() => create.mutate()} loading={create.isPending} icon={<Plus className="h-4 w-4" />}>
                New pattern
              </Button>
              <Button icon={<Save className="h-4 w-4" />} loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>
                Save
              </Button>
            </>
          )
        }
      />

      <div className="flex flex-wrap gap-2">
        {patterns.map((pattern) => (
          <button
            key={pattern.id}
            type="button"
            onClick={() => setSelectedId(pattern.id)}
            className={
              pattern.id === selectedId
                ? "rounded-[calc(var(--radius)-2px)] border border-brand-400 bg-brand-50 px-3 py-1.5 text-[13px] font-medium text-brand-700"
                : "rounded-[calc(var(--radius)-2px)] border px-3 py-1.5 text-[13px] text-[var(--text-muted)] hover:bg-[var(--surface-muted)]"
            }
          >
            {pattern.name}
            {!pattern.isActive && <span className="ml-1.5 text-[11px]">(inactive)</span>}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader title="About this pattern" />
        <div className="mt-4 space-y-4">
          <FieldGrid columns={2}>
            <Input
              label="Name"
              value={draft.name}
              disabled={!canManage}
              onChange={(e) => set("name", e.target.value)}
              labelSuffix={help("name", "Name")}
            />
            <Input label="Code" value={draft.code} disabled hint="Set once, when the pattern is created." />
          </FieldGrid>

          <Select
            label="How does this roster repeat?"
            value={draft.type}
            disabled={!canManage}
            labelSuffix={help("type", "How does this roster repeat?")}
            onChange={(e) => {
              const type = e.target.value as ShiftPattern["type"];
              set("type", type);
              if (type === "weekly" && !draft.days?.length) {
                set("days", WEEKDAYS.map((_, day) => ({ day, shiftId: null })));
              }
              if (type === "rotating" && !draft.cycle?.length) {
                set("cycle", [{ position: 0, shiftId: null }]);
                if (!draft.anchorDate) set("anchorDate", new Date().toISOString().slice(0, 10));
              }
            }}
            options={[
              { value: "weekly", label: "The same every week — set by day of the week" },
              { value: "rotating", label: "A rotation — a cycle that repeats regardless of weekday" },
            ]}
          />

          <Switch
            label="Active"
            hint="An inactive pattern is ignored — anyone on it falls back to their standing shift."
            checked={draft.isActive}
            disabled={!canManage}
            onChange={(v) => set("isActive", v)}
            labelSuffix={help("isActive", "Active")}
          />
        </div>
      </Card>

      {draft.type === "weekly" ? (
        <Card>
          <CardHeader title="Which shift on each day" description="Leave a day as 'Day off' and nobody on this pattern is expected in." />
          <div className="mt-4 space-y-2.5">
            {WEEKDAYS.map((label, day) => {
              const rule = draft.days?.find((d) => d.day === day);
              return (
                <div key={day} className="grid grid-cols-[7rem_1fr] items-center gap-3">
                  <span className="text-[13px] font-medium text-[var(--text)]">{label}</span>
                  <Select
                    value={rule?.shiftId || ""}
                    disabled={!canManage}
                    options={shiftOptions}
                    onChange={(e) => {
                      const shiftId = e.target.value || null;
                      update("days", (previous) =>
                        WEEKDAYS.map((_, d) => {
                          const existing = (previous || []).find((x) => x.day === d);
                          return d === day
                            ? { day: d, shiftId }
                            : { day: d, shiftId: existing?.shiftId ?? null };
                        })
                      );
                    }}
                  />
                </div>
              );
            })}
          </div>
        </Card>
      ) : (
        <Card>
          <CardHeader
            title="The rotation"
            description="One row per day of the cycle. When it reaches the end it starts again from the top."
          />
          <div className="mt-4 space-y-4">
            <FieldGrid columns={2}>
              <Input
                label="The cycle starts on"
                type="date"
                value={draft.anchorDate || ""}
                disabled={!canManage}
                onChange={(e) => set("anchorDate", e.target.value)}
                hint="Day 1 of the rotation falls on this date."
                labelSuffix={help("anchorDate", "The cycle starts on")}
              />
            </FieldGrid>

            <div className="space-y-2.5">
              {(draft.cycle || []).map((entry, index) => (
                <div key={index} className="grid grid-cols-[5rem_1fr_auto] items-center gap-3">
                  <span className="text-[13px] font-medium text-[var(--text)]">Day {index + 1}</span>
                  <Select
                    value={entry.shiftId || ""}
                    disabled={!canManage}
                    options={shiftOptions}
                    onChange={(e) => {
                      const shiftId = e.target.value || null;
                      update("cycle", (previous) =>
                        (previous || []).map((c, i) =>
                          i === index ? { position: i, shiftId } : { position: i, shiftId: c.shiftId }
                        )
                      );
                    }}
                  />
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove day ${index + 1}`}
                      onClick={() =>
                        update("cycle", (previous) =>
                          (previous || [])
                            .filter((_, i) => i !== index)
                            .map((c, i) => ({ position: i, shiftId: c.shiftId }))
                        )
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5 text-[var(--danger)]" />
                    </Button>
                  )}
                </div>
              ))}

              {canManage && (
                <Button
                  variant="outline"
                  size="sm"
                  icon={<Plus className="h-3.5 w-3.5" />}
                  onClick={() =>
                    update("cycle", (previous) => [
                      ...(previous || []),
                      { position: (previous || []).length, shiftId: null },
                    ])
                  }
                >
                  Add a day to the cycle
                </Button>
              )}
            </div>

            <Callout tone="info">
              A cycle whose length is not 7 deliberately drifts against the week — that is what makes
              it a rotation. A 7-day cycle behaves like a weekly roster.
            </Callout>
          </div>
        </Card>
      )}

      <PatternPreview patternId={draft.id} dirty={dirty} />

      {canManage && (
        <div className="flex justify-end">
          <Button variant="outline" icon={<Trash2 className="h-4 w-4" />} onClick={() => setDeleting(true)}>
            Delete this pattern
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
        tone="danger"
        title="Delete this pattern?"
        confirmLabel="Delete"
        message="Anyone currently on it must be moved to another pattern or shift first. Attendance already calculated is not changed."
      />
    </div>
  );
}

/**
 * The next four weeks, resolved through the same code the attendance engine
 * uses. A rotation is nearly impossible to picture from its configuration —
 * this is what makes it checkable before real people are rostered onto it.
 */
function PatternPreview({ patternId, dirty }: { patternId: string; dirty: boolean }) {
  const from = new Date();
  const to = new Date(Date.now() + 27 * 86400000);
  const fromDate = from.toISOString().slice(0, 10);
  const toDate = to.toISOString().slice(0, 10);

  const { data, isLoading } = useQuery({
    queryKey: ["shift-pattern-preview", patternId, fromDate],
    queryFn: async () =>
      (
        await api.get<{ days: Array<{ date: string; isOff: boolean; uncovered: boolean; shift: Shift | null }> }>(
          `/shifts/patterns/${patternId}/preview`,
          { query: { fromDate, toDate } }
        )
      ).data,
  });

  return (
    <Card>
      <CardHeader
        title="What this produces"
        description="The next four weeks, resolved exactly as attendance will read it."
      />

      {dirty && (
        <Callout tone="warning" className="mt-3">
          Showing the last saved version. Save to see your changes here.
        </Callout>
      )}

      {isLoading ? (
        <div className="skeleton mt-4 h-24" />
      ) : (
        <div className="mt-4 grid grid-cols-7 gap-1.5">
          {(data?.days || []).map((day) => (
            <div
              key={day.date}
              className="rounded-md border p-1.5 text-center"
              style={day.shift ? { borderColor: day.shift.colour } : undefined}
            >
              <p className="text-[10.5px] text-[var(--text-subtle)]">{day.date.slice(5)}</p>
              {day.uncovered ? (
                <p className="mt-0.5 text-[10.5px] text-[var(--text-subtle)]">—</p>
              ) : day.isOff ? (
                <p className="mt-0.5 text-[10.5px] font-medium text-[var(--text-muted)]">Off</p>
              ) : (
                <p className="mt-0.5 truncate text-[10.5px] font-medium" style={{ color: day.shift?.colour }}>
                  {day.shift?.code || "?"}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="mt-3 text-[12px] text-[var(--text-subtle)]">
        <Badge tone="neutral">—</Badge> means the pattern says nothing about that day, so the
        employee&apos;s own standing shift applies instead.
      </p>
    </Card>
  );
}
