"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, ClipboardCheck, ListChecks, Play, Plus, SkipForward, Square, Target, Trash2, TrendingUp, Users } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatDate, formatRelative } from "@/lib/format";
import { Badge, Button, Callout, Checkbox, ConfirmDialog, Drawer, EmptyState, FieldGrid, Input, Modal, NoAccessState, PageHeader, PageLoader, Select, StatCard, Switch, Tabs, Textarea, useToast } from "@/components/ui";
import { AudienceFields, DistributionBars, ProgressBar } from "@/components/modules/EngagementBits";
import { ReviewDrawer } from "@/components/modules/ReviewDrawer";
import { useEmployeeOptions } from "@/components/documents/EmployeePicker";
import { GoalDialog, ProgressDialog } from "@/app/me/performance/page";
import { CYCLE_STATUS_LABELS, EMPTY_AUDIENCE, REVIEW_STATUS_LABELS, type Audience, type CycleSection, type CycleSummary, type Goal, type Review, type ReviewCycle } from "@/lib/engagementTypes";

/**
 * Performance for managers and HR: the reviews waiting on you, your team's
 * goals, and (HR) the review cycles themselves.
 */
export default function PerformancePage() {
  const { session, can } = useSession();
  const [tab, setTab] = useState("reviews");
  const manage = can("performance.manage");

  if (!can("performance.review") && !manage) return <NoAccessState what="performance management" />;

  const tabs = [
    { key: "reviews", label: "To review", icon: <ClipboardCheck className="h-3.5 w-3.5" /> },
    { key: "goals", label: manage ? "All goals" : "Team goals", icon: <Target className="h-3.5 w-3.5" /> },
    ...(manage ? [{ key: "cycles", label: "Review cycles", icon: <ListChecks className="h-3.5 w-3.5" /> }] : []),
  ];

  return (
    <>
      <PageHeader title="Performance" description="Reviews waiting on you, goals across your team, and the cycles that drive them." />
      <Tabs items={tabs} active={tab} onChange={setTab} className="mb-5" />
      {tab === "reviews" && <ToReviewTab />}
      {tab === "goals" && <GoalsTab scope={manage ? "all" : "team"} locale={session?.organization?.locale || "en-IN"} />}
      {tab === "cycles" && manage && <CyclesTab locale={session?.organization?.locale || "en-IN"} />}
    </>
  );
}

// ── To review ────────────────────────────────────────────────────────────────

function ToReviewTab() {
  const [open, setOpen] = useState<Review | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["performance", "reviews", "to-review"],
    queryFn: async () => (await api.get<Review[]>("/performance/reviews/to-review")).data,
  });
  const rows = data || [];
  const waiting = rows.filter((r) => r.status === "pending_manager");
  const notYet = rows.filter((r) => r.status === "pending_self");
  const done = rows.filter((r) => r.status === "completed");

  if (isLoading) return <PageLoader label="Loading reviews" />;
  if (rows.length === 0) return <EmptyState icon={<ClipboardCheck className="h-5 w-5" />} title="Nothing to review" description="When a cycle reaches you, the people you review appear here." />;

  const Section = ({ title, items, hint }: { title: string; items: Review[]; hint?: string }) =>
    items.length === 0 ? null : (
      <div>
        <p className="text-[13px] font-semibold text-[var(--text)]">
          {title} <span className="font-normal text-[var(--text-muted)]">({items.length})</span>
        </p>
        {hint && <p className="text-[12.5px] text-[var(--text-muted)]">{hint}</p>}
        <ul className="mt-2 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          {items.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-[13.5px] font-medium text-[var(--text)]">
                  {r.employee?.name || "—"} <span className="font-normal text-[var(--text-muted)]">{r.employee?.code ? `· ${r.employee.code}` : ""}</span>
                </p>
                <p className="text-[12.5px] text-[var(--text-muted)]">
                  {r.cycle.name} · {REVIEW_STATUS_LABELS[r.status]}
                  {r.self.submittedAt ? ` · self-review ${formatRelative(r.self.submittedAt)}` : ""}
                  {r.cycle.managerDueAt && r.status === "pending_manager" ? ` · due ${formatDate(r.cycle.managerDueAt)}` : ""}
                </p>
              </div>
              <Button variant={r.status === "pending_manager" ? "primary" : "outline"} size="sm" onClick={() => setOpen(r)}>
                {r.status === "pending_manager" ? "Write review" : "Open"}
              </Button>
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <div className="space-y-5">
      <Section title="Ready for you" items={waiting} />
      <Section title="Waiting on self-review" items={notYet} hint="You can read what is there; the form opens once they submit or HR moves the cycle on." />
      <Section title="Completed, awaiting acknowledgement" items={done} />
      {open && <ReviewDrawer reviewId={open.id} mode="reviewer" onClose={() => setOpen(null)} />}
    </div>
  );
}

// ── Goals ────────────────────────────────────────────────────────────────────

function GoalsTab({ scope, locale }: { scope: "team" | "all"; locale: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState<Goal | null>(null);
  const [removing, setRemoving] = useState<Goal | null>(null);
  const [status, setStatus] = useState("active");
  const { employees } = useEmployeeOptions(creating);

  const { data, isLoading } = useQuery({
    queryKey: ["performance", "goals", scope, status],
    queryFn: async () => (await api.get<Goal[]>("/performance/goals", { query: { scope, status: status || undefined } })).data,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/performance/goals/${id}`),
    onSuccess: () => {
      toast.success("Goal removed");
      setRemoving(null);
      queryClient.invalidateQueries({ queryKey: ["performance", "goals"] });
    },
    onError: (error) => toast.fromError(error, "Could not remove the goal."),
  });

  const grouped = useMemo(() => {
    const map = new Map<string, { name: string; goals: Goal[] }>();
    for (const g of data || []) {
      const key = g.employeeId;
      if (!map.has(key)) map.set(key, { name: g.employee?.name || "—", goals: [] });
      map.get(key)!.goals.push(g);
    }
    return [...map.entries()].sort(([, a], [, b]) => a.name.localeCompare(b.name));
  }, [data]);

  const rows = data || [];
  const average = rows.length ? Math.round(rows.reduce((a, g) => a + g.progress, 0) / rows.length) : 0;

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Goals" value={String(rows.length)} icon={<Target className="h-4 w-4" />} />
        <StatCard label="People with goals" value={String(grouped.length)} icon={<Users className="h-4 w-4" />} />
        <StatCard label="Average progress" value={`${average}%`} icon={<TrendingUp className="h-4 w-4" />} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: "active", label: "In progress" }, { value: "completed", label: "Completed" }, { value: "cancelled", label: "Cancelled" }, { value: "", label: "All" }]} aria-label="Status" />
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
          New goal
        </Button>
      </div>

      {isLoading ? (
        <PageLoader label="Loading goals" />
      ) : grouped.length === 0 ? (
        <EmptyState icon={<Target className="h-5 w-5" />} title="No goals here" description={scope === "team" ? "Set goals for the people who report to you." : "Nobody has goals matching this filter."} action={<Button onClick={() => setCreating(true)}>New goal</Button>} />
      ) : (
        <div className="space-y-4">
          {grouped.map(([employeeId, group]) => (
            <div key={employeeId} className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
                <p className="text-[13.5px] font-semibold text-[var(--text)]">{group.name}</p>
                <p className="text-[12.5px] text-[var(--text-muted)]">
                  {group.goals.length} goal{group.goals.length === 1 ? "" : "s"} · weight {group.goals.reduce((a, g) => a + g.weight, 0)}
                </p>
              </div>
              <ul className="divide-y divide-[var(--border)]">
                {group.goals.map((g) => (
                  <li key={g.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-medium text-[var(--text)]">{g.title}</p>
                        <p className="text-[12.5px] text-[var(--text-muted)]">
                          {g.metric ? `${g.metric}${g.target ? ` → ${g.target}` : ""} · ` : ""}weight {g.weight}
                          {g.dueDate ? ` · due ${formatDate(g.dueDate, { locale })}` : ""}
                          {g.updates[0] ? ` · updated ${formatRelative(g.updates[0].at)}` : ""}
                        </p>
                        <div className="mt-2 max-w-md">
                          <ProgressBar value={g.progress} />
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {g.status === "completed" ? <Badge tone="success">Done</Badge> : g.status === "cancelled" ? <Badge tone="neutral">Cancelled</Badge> : <span className="tabular text-[13px] font-semibold text-[var(--text)]">{g.progress}%</span>}
                        {g.status === "active" && (
                          <Button variant="ghost" size="sm" icon={<TrendingUp className="h-3.5 w-3.5" />} onClick={() => setUpdating(g)}>
                            Update
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" aria-label="Remove goal" onClick={() => setRemoving(g)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {creating && <GoalDialog employees={employees.map((e) => ({ id: e.id, label: `${e.fullName}${e.employeeCode ? ` (${e.employeeCode})` : ""}` }))} onClose={() => setCreating(false)} />}
      {updating && <ProgressDialog goal={updating} onClose={() => setUpdating(null)} />}
      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) remove.mutate(removing.id);
        }}
        loading={remove.isPending}
        tone="danger"
        title={`Remove "${removing?.title}"?`}
        confirmLabel="Remove"
        message="Its progress history goes with it. Reviews that already snapshotted it keep their copy."
      />
    </div>
  );
}

// ── Cycles ───────────────────────────────────────────────────────────────────

function CyclesTab({ locale }: { locale: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<ReviewCycle | "new" | null>(null);
  const [confirm, setConfirm] = useState<{ cycle: ReviewCycle; action: "start" | "advance" | "close" } | null>(null);
  const [summaryOf, setSummaryOf] = useState<ReviewCycle | null>(null);
  const [reviewsOf, setReviewsOf] = useState<ReviewCycle | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["performance", "cycles"],
    queryFn: async () => (await api.get<ReviewCycle[]>("/performance/cycles")).data,
  });

  const act = useMutation({
    mutationFn: async ({ cycle, action }: { cycle: ReviewCycle; action: "start" | "advance" | "close" }) => (await api.post<ReviewCycle>(`/performance/cycles/${cycle.id}/${action}`)).data,
    onSuccess: (result, { action }) => {
      if (action === "start") toast.success("Cycle started", `${result.participants} people are in. ${result.selfReviewRequired ? "They have been asked for self-reviews." : "Managers have been told."}`);
      else if (action === "advance") toast.success("Moved to manager review", "Managers have been told what is waiting.");
      else toast.success("Cycle closed");
      setConfirm(null);
      queryClient.invalidateQueries({ queryKey: ["performance"] });
    },
    onError: (error) => toast.fromError(error, "That did not work."),
  });

  const rows = data || [];

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing("new")}>
          New cycle
        </Button>
      </div>
      {isLoading ? (
        <PageLoader label="Loading cycles" />
      ) : rows.length === 0 ? (
        <EmptyState icon={<ListChecks className="h-5 w-5" />} title="No review cycles yet" description="A cycle is a period, an audience and a form. Start one and every participant gets a review with their manager." action={<Button onClick={() => setEditing("new")}>New cycle</Button>} />
      ) : (
        <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          {rows.map((c) => (
            <li key={c.id} className="px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[14px] font-medium text-[var(--text)]">{c.name}</p>
                    <Badge tone={c.status === "closed" ? "neutral" : c.status === "draft" ? "warning" : "info"}>{CYCLE_STATUS_LABELS[c.status]}</Badge>
                  </div>
                  <p className="mt-0.5 text-[12.5px] text-[var(--text-muted)]">
                    {formatDate(c.periodStart, { locale })} to {formatDate(c.periodEnd, { locale })} · scale 1 to {c.ratingScale} · {c.selfReviewRequired ? "self-review first" : "manager only"}
                    {c.status !== "draft" ? ` · ${c.participants} people · ${c.completion}% complete` : ""}
                    {c.selfDueAt && c.status === "self_review" ? ` · self-reviews due ${formatDate(c.selfDueAt, { locale })}` : ""}
                    {c.managerDueAt && c.status === "manager_review" ? ` · manager reviews due ${formatDate(c.managerDueAt, { locale })}` : ""}
                  </p>
                  {c.status !== "draft" && (
                    <div className="mt-2 max-w-md">
                      <ProgressBar value={c.completion} tone="success" />
                      <p className="mt-1 text-[12px] text-[var(--text-muted)]">
                        {c.counts.pending_self} awaiting self-review · {c.counts.pending_manager} awaiting manager · {c.counts.completed} completed · {c.counts.acknowledged} acknowledged
                      </p>
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1">
                  {c.status === "draft" && (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => setEditing(c)}>
                        Edit
                      </Button>
                      <Button size="sm" icon={<Play className="h-3.5 w-3.5" />} onClick={() => setConfirm({ cycle: c, action: "start" })}>
                        Start
                      </Button>
                    </>
                  )}
                  {c.status === "self_review" && (
                    <Button variant="outline" size="sm" icon={<SkipForward className="h-3.5 w-3.5" />} onClick={() => setConfirm({ cycle: c, action: "advance" })}>
                      Move to manager review
                    </Button>
                  )}
                  {c.status !== "draft" && (
                    <>
                      <Button variant="ghost" size="sm" icon={<ClipboardCheck className="h-3.5 w-3.5" />} onClick={() => setReviewsOf(c)}>
                        Reviews
                      </Button>
                      <Button variant="ghost" size="sm" icon={<BarChart3 className="h-3.5 w-3.5" />} onClick={() => setSummaryOf(c)}>
                        Summary
                      </Button>
                    </>
                  )}
                  {(c.status === "self_review" || c.status === "manager_review") && (
                    <Button variant="ghost" size="sm" icon={<Square className="h-3.5 w-3.5" />} onClick={() => setConfirm({ cycle: c, action: "close" })}>
                      Close
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <CycleDialog
          cycle={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            queryClient.invalidateQueries({ queryKey: ["performance", "cycles"] });
          }}
        />
      )}
      {summaryOf && <SummaryDrawer cycle={summaryOf} onClose={() => setSummaryOf(null)} />}
      {reviewsOf && <CycleReviewsDrawer cycle={reviewsOf} onClose={() => setReviewsOf(null)} />}

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (confirm) act.mutate(confirm);
        }}
        loading={act.isPending}
        title={confirm?.action === "start" ? `Start "${confirm.cycle.name}"?` : confirm?.action === "advance" ? "Move to manager review?" : `Close "${confirm?.cycle.name}"?`}
        confirmLabel={confirm?.action === "start" ? "Start and notify" : confirm?.action === "advance" ? "Move on" : "Close"}
        message={
          confirm?.action === "start"
            ? "One review is created per person in the audience, with their manager as reviewer, and current goals are snapshotted. Sections and the rating scale lock."
            : confirm?.action === "advance"
              ? "Anyone who has not submitted a self-review is moved on without one. Managers are told what is waiting."
              : "No more reviews can be written. Completed ones stay readable."
        }
      />
    </div>
  );
}

function slug(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "section";
}

function CycleDialog({ cycle, onClose, onSaved }: { cycle: ReviewCycle | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(cycle?.name || "");
  const [periodStart, setPeriodStart] = useState(cycle?.periodStart ? cycle.periodStart.slice(0, 10) : "");
  const [periodEnd, setPeriodEnd] = useState(cycle?.periodEnd ? cycle.periodEnd.slice(0, 10) : "");
  const [selfDueAt, setSelfDueAt] = useState(cycle?.selfDueAt ? cycle.selfDueAt.slice(0, 10) : "");
  const [managerDueAt, setManagerDueAt] = useState(cycle?.managerDueAt ? cycle.managerDueAt.slice(0, 10) : "");
  const [ratingScale, setRatingScale] = useState(cycle?.ratingScale || 5);
  const [selfReviewRequired, setSelfReviewRequired] = useState(cycle ? cycle.selfReviewRequired : true);
  const [audience, setAudience] = useState<Audience>(cycle?.audience || EMPTY_AUDIENCE);
  const [sections, setSections] = useState<CycleSection[]>(cycle?.sections || []);

  const { data: catalog } = useQuery({
    queryKey: ["performance", "catalog"],
    queryFn: async () => (await api.get<{ defaultSections: CycleSection[] }>("/performance/catalog")).data,
    staleTime: 10 * 60_000,
  });
  const effectiveSections = sections.length ? sections : catalog?.defaultSections || [];

  const setSection = (i: number, patch: Partial<CycleSection>) => setSections(effectiveSections.map((s, idx) => (idx === i ? { ...s, ...patch, key: patch.title !== undefined ? slug(patch.title) : s.key } : s)));

  const valid = name.trim() && periodStart && periodEnd && periodEnd >= periodStart && effectiveSections.length > 0 && effectiveSections.every((s) => s.title.trim());

  const save = useMutation({
    mutationFn: async () => {
      const body = { name: name.trim(), periodStart, periodEnd, selfDueAt: selfDueAt || null, managerDueAt: managerDueAt || null, ratingScale, selfReviewRequired, audience, sections: effectiveSections.map((s) => ({ key: s.key || slug(s.title), title: s.title.trim(), description: s.description || "", rated: s.rated })) };
      if (cycle) return api.patch(`/performance/cycles/${cycle.id}`, body);
      return api.post("/performance/cycles", body);
    },
    onSuccess: () => {
      toast.success(cycle ? "Cycle saved" : "Cycle created", cycle ? undefined : "Start it when you are ready.");
      onSaved();
    },
    onError: (error) => toast.fromError(error, "Could not save the cycle."),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={cycle ? `Edit: ${cycle.name}` : "New review cycle"}
      size="xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>
            {cycle ? "Save" : "Create cycle"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <FieldGrid columns={3}>
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="H1 2026" required />
          <Input label="Period from" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} required />
          <Input label="Period to" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} required />
        </FieldGrid>
        <FieldGrid columns={3}>
          <Input label="Self-reviews due (optional)" type="date" value={selfDueAt} onChange={(e) => setSelfDueAt(e.target.value)} />
          <Input label="Manager reviews due (optional)" type="date" value={managerDueAt} onChange={(e) => setManagerDueAt(e.target.value)} />
          <Select label="Rating scale" value={String(ratingScale)} onChange={(e) => setRatingScale(Number(e.target.value))} options={[3, 4, 5, 7, 10].map((n) => ({ value: String(n), label: `1 to ${n}` }))} />
        </FieldGrid>
        <Switch label="Employees write a self-review first" hint="Managers see it beside their own form. Off: the cycle goes straight to managers." checked={selfReviewRequired} onChange={setSelfReviewRequired} />
        <AudienceFields value={audience} onChange={setAudience} />

        <div>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-[var(--text)]">Review form</p>
            <Button variant="outline" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setSections([...effectiveSections, { key: `section_${effectiveSections.length + 1}`, title: "", description: "", rated: true }])}>
              Add section
            </Button>
          </div>
          <p className="text-[12.5px] text-[var(--text-muted)]">Each section is rated on the scale and has room for comments. Unrated sections are comments only.</p>
          <div className="mt-3 space-y-2">
            {effectiveSections.map((s, i) => (
              <div key={i} className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                <FieldGrid columns={3}>
                  <Input label="Section" value={s.title} onChange={(e) => setSection(i, { title: e.target.value })} required />
                  <div className="sm:col-span-2">
                    <Input label="Guidance (optional)" value={s.description} onChange={(e) => setSection(i, { description: e.target.value })} placeholder="What to consider when rating this." />
                  </div>
                </FieldGrid>
                <div className="mt-2 flex items-center justify-between">
                  <Checkbox label="Rated" checked={s.rated} onChange={(e) => setSection(i, { rated: e.target.checked })} />
                  <Button variant="ghost" size="icon" aria-label="Remove section" disabled={effectiveSections.length === 1} onClick={() => setSections(effectiveSections.filter((_, idx) => idx !== i))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function SummaryDrawer({ cycle, onClose }: { cycle: ReviewCycle; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["performance", "cycles", cycle.id, "summary"],
    queryFn: async () => (await api.get<CycleSummary>(`/performance/cycles/${cycle.id}/summary`)).data,
  });
  return (
    <Drawer open onClose={onClose} title={`Summary: ${cycle.name}`} description={data ? `${data.ratings.length} rated · average ${data.average ?? "—"} of ${cycle.ratingScale}` : undefined} width="lg">
      {isLoading || !data ? (
        <PageLoader label="Adding up" />
      ) : data.ratings.length === 0 ? (
        <EmptyState icon={<BarChart3 className="h-5 w-5" />} title="No ratings yet" description="The distribution appears as managers complete reviews." />
      ) : (
        <div className="space-y-6">
          <div>
            <p className="text-[13.5px] font-medium text-[var(--text)]">Overall ratings</p>
            <div className="mt-2">
              <DistributionBars counts={data.distribution} total={data.ratings.length} />
            </div>
          </div>
          <div>
            <p className="text-[13.5px] font-medium text-[var(--text)]">Section averages</p>
            <ul className="mt-2 space-y-1 text-[13px]">
              {cycle.sections
                .filter((s) => s.rated)
                .map((s) => (
                  <li key={s.key} className="flex items-center justify-between">
                    <span className="text-[var(--text)]">{s.title}</span>
                    <span className="tabular text-[var(--text-muted)]">{data.sectionAverages[s.key] ?? "—"}</span>
                  </li>
                ))}
            </ul>
          </div>
          <div>
            <p className="text-[13.5px] font-medium text-[var(--text)]">By person</p>
            <Callout tone="info" className="mt-1">
              For calibration: look for managers whose whole team sits at one number.
            </Callout>
            <ul className="mt-2 divide-y divide-[var(--border)]">
              {data.ratings.map((r) => (
                <li key={r.employeeId} className="flex items-center justify-between py-1.5 text-[13px]">
                  <span className="text-[var(--text)]">
                    {r.name} {r.code && <span className="text-[var(--text-muted)]">· {r.code}</span>}
                  </span>
                  <Badge tone="brand">
                    {r.overallRating} / {cycle.ratingScale}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Drawer>
  );
}

function CycleReviewsDrawer({ cycle, onClose }: { cycle: ReviewCycle; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<Review | null>(null);
  const [reassign, setReassign] = useState<Review | null>(null);
  const [reviewerId, setReviewerId] = useState("");
  const { employees } = useEmployeeOptions(Boolean(reassign));

  const { data, isLoading } = useQuery({
    queryKey: ["performance", "cycles", cycle.id],
    queryFn: async () => (await api.get<ReviewCycle>(`/performance/cycles/${cycle.id}`)).data,
  });

  const move = useMutation({
    mutationFn: async () => api.patch(`/performance/reviews/${reassign!.id}/reviewer`, { reviewerId }),
    onSuccess: () => {
      toast.success("Reviewer changed");
      setReassign(null);
      setReviewerId("");
      queryClient.invalidateQueries({ queryKey: ["performance"] });
    },
    onError: (error) => toast.fromError(error, "Could not change the reviewer."),
  });

  return (
    <Drawer open onClose={onClose} title={`Reviews: ${cycle.name}`} description="Every participant, their reviewer, and where they are." width="lg">
      {isLoading || !data ? (
        <PageLoader label="Loading reviews" />
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {(data.reviews || []).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[13.5px] font-medium text-[var(--text)]">
                  {r.employee?.name || "—"} <span className="font-normal text-[var(--text-muted)]">{r.employee?.code ? `· ${r.employee.code}` : ""}</span>
                </p>
                <p className="text-[12.5px] text-[var(--text-muted)]">
                  {REVIEW_STATUS_LABELS[r.status]} · reviewer {r.reviewer?.name || <span className="text-[var(--danger)]">none</span>}
                  {r.manager?.overallRating ? ` · rated ${r.manager.overallRating}/${cycle.ratingScale}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {!["completed", "acknowledged"].includes(r.status) && (
                  <Button variant="ghost" size="sm" onClick={() => setReassign(r)}>
                    {r.reviewer ? "Change reviewer" : "Assign reviewer"}
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => setOpen(r)}>
                  Open
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {open && <ReviewDrawer reviewId={open.id} mode="reviewer" onClose={() => setOpen(null)} />}
      {reassign && (
        <Modal
          open
          onClose={() => setReassign(null)}
          title={`Reviewer for ${reassign.employee?.name || "this review"}`}
          size="sm"
          footer={
            <>
              <Button variant="outline" onClick={() => setReassign(null)}>
                Cancel
              </Button>
              <Button disabled={!reviewerId} loading={move.isPending} onClick={() => move.mutate()}>
                Save
              </Button>
            </>
          }
        >
          <Select label="Reviewer" value={reviewerId} onChange={(e) => setReviewerId(e.target.value)} placeholder="Choose a person" options={employees.filter((e) => e.id !== reassign.employee?.id).map((e) => ({ value: e.id, label: `${e.fullName}${e.employeeCode ? ` (${e.employeeCode})` : ""}` }))} />
        </Modal>
      )}
    </Drawer>
  );
}
