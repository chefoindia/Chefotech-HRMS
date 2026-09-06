"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ClipboardCheck, Plus, Target, TrendingUp } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatDate, formatRelative } from "@/lib/format";
import { Badge, Button, Card, CardHeader, EmptyState, FieldGrid, Input, Modal, PageHeader, PageLoader, Select, Textarea, useToast } from "@/components/ui";
import { ProgressBar } from "@/components/modules/EngagementBits";
import { ReviewDrawer } from "@/components/modules/ReviewDrawer";
import { REVIEW_STATUS_LABELS, type Goal, type Review } from "@/lib/engagementTypes";

/** My goals and my reviews. */
export default function MyPerformancePage() {
  const { session, can } = useSession();
  const locale = session?.organization?.locale || "en-IN";
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState<Goal | null>(null);
  const [openReview, setOpenReview] = useState<Review | null>(null);

  const goals = useQuery({
    queryKey: ["performance", "goals", "mine"],
    queryFn: async () => (await api.get<Goal[]>("/performance/goals", { query: { scope: "mine" } })).data,
    enabled: can("performance.view_own") && Boolean(session?.employeeId),
  });
  const reviews = useQuery({
    queryKey: ["performance", "reviews", "mine"],
    queryFn: async () => (await api.get<Review[]>("/performance/reviews/me")).data,
    enabled: can("performance.view_own") && Boolean(session?.employeeId),
  });

  if (!can("performance.view_own")) return <EmptyState icon={<Target className="h-5 w-5" />} title="Performance is not enabled for you" description="Ask HR if you think you should be seeing goals and reviews." />;

  const active = (goals.data || []).filter((g) => g.status === "active");
  const finished = (goals.data || []).filter((g) => g.status !== "active");
  const pendingReviews = (reviews.data || []).filter((r) => r.status === "pending_self" || r.status === "completed");

  return (
    <>
      <PageHeader
        title="My performance"
        description="Goals you are working towards, and reviews with your manager."
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            New goal
          </Button>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader title="Goals" description={active.length ? `${active.length} in progress` : "Nothing in progress"} />
          {goals.isLoading ? (
            <PageLoader label="Loading goals" />
          ) : active.length === 0 && finished.length === 0 ? (
            <EmptyState icon={<Target className="h-5 w-5" />} title="No goals yet" description="Agree a few with your manager, or add your own." action={<Button onClick={() => setCreating(true)}>New goal</Button>} />
          ) : (
            <ul className="mt-4 space-y-3">
              {[...active, ...finished].map((g) => (
                <li key={g.id} className="rounded-lg border border-[var(--border)] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-medium text-[var(--text)]">{g.title}</p>
                      <p className="text-[12.5px] text-[var(--text-muted)]">
                        {g.metric ? `${g.metric}${g.target ? ` → ${g.target}` : ""} · ` : ""}weight {g.weight}
                        {g.dueDate ? ` · due ${formatDate(g.dueDate, { locale })}` : ""}
                        {g.alignedTo ? ` · supports "${g.alignedTo.title}"` : ""}
                      </p>
                    </div>
                    {g.status === "completed" ? <Badge tone="success">Done</Badge> : g.status === "cancelled" ? <Badge tone="neutral">Cancelled</Badge> : <span className="tabular text-[13px] font-semibold text-[var(--text)]">{g.progress}%</span>}
                  </div>
                  <div className="mt-2">
                    <ProgressBar value={g.progress} />
                  </div>
                  {g.status === "active" && (
                    <div className="mt-2 flex items-center justify-between">
                      <p className="text-[12px] text-[var(--text-muted)]">{g.updates[0] ? `Last update ${formatRelative(g.updates[0].at)}${g.updates[0].note ? `: ${g.updates[0].note}` : ""}` : "No updates yet"}</p>
                      <Button variant="outline" size="sm" icon={<TrendingUp className="h-3.5 w-3.5" />} onClick={() => setUpdating(g)}>
                        Update
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Reviews" description={pendingReviews.length ? `${pendingReviews.length} need${pendingReviews.length === 1 ? "s" : ""} your attention` : "Nothing waiting on you"} />
          {reviews.isLoading ? (
            <PageLoader label="Loading reviews" />
          ) : (reviews.data || []).length === 0 ? (
            <EmptyState icon={<ClipboardCheck className="h-5 w-5" />} title="No reviews yet" description="When HR starts a review cycle you are part of, it appears here." />
          ) : (
            <ul className="mt-4 divide-y divide-[var(--border)]">
              {(reviews.data || []).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-medium text-[var(--text)]">{r.cycle.name}</p>
                    <p className="text-[12.5px] text-[var(--text-muted)]">
                      {REVIEW_STATUS_LABELS[r.status]}
                      {r.reviewer?.name ? ` · reviewer ${r.reviewer.name}` : ""}
                      {r.status === "pending_self" && r.cycle.selfDueAt ? ` · by ${formatDate(r.cycle.selfDueAt, { locale })}` : ""}
                    </p>
                  </div>
                  {r.status === "acknowledged" ? (
                    <Button variant="ghost" size="sm" icon={<CheckCircle2 className="h-3.5 w-3.5" />} onClick={() => setOpenReview(r)}>
                      View
                    </Button>
                  ) : (
                    <Button variant={r.status === "pending_self" || r.status === "completed" ? "primary" : "outline"} size="sm" onClick={() => setOpenReview(r)}>
                      {r.status === "pending_self" ? "Write self-review" : r.status === "completed" ? "Read and acknowledge" : "View"}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {creating && <GoalDialog onClose={() => setCreating(false)} />}
      {updating && <ProgressDialog goal={updating} onClose={() => setUpdating(null)} />}
      {openReview && <ReviewDrawer reviewId={openReview.id} mode="subject" onClose={() => setOpenReview(null)} />}
    </>
  );
}

export function GoalDialog({ employeeId, employees, onClose }: { employeeId?: string; employees?: Array<{ id: string; label: string }>; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState(employeeId || "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [metric, setMetric] = useState("");
  const [target, setTarget] = useState("");
  const [weight, setWeight] = useState(25);
  const [dueDate, setDueDate] = useState("");

  const create = useMutation({
    mutationFn: async () => api.post("/performance/goals", { employeeId: chosen || undefined, title: title.trim(), description, metric, target, weight, dueDate: dueDate || null }),
    onSuccess: () => {
      toast.success("Goal added");
      queryClient.invalidateQueries({ queryKey: ["performance", "goals"] });
      onClose();
    },
    onError: (error) => toast.fromError(error, "Could not add the goal."),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="New goal"
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!title.trim() || (Boolean(employees) && !chosen)} loading={create.isPending} onClick={() => create.mutate()}>
            Add goal
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {employees && <Select label="For" value={chosen} onChange={(e) => setChosen(e.target.value)} placeholder="Choose a person" options={employees.map((e) => ({ value: e.id, label: e.label }))} required />}
        <Input label="Goal" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Cut average prep time by 10%" required />
        <Textarea label="Why it matters (optional)" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        <FieldGrid columns={2}>
          <Input label="How it is measured" value={metric} onChange={(e) => setMetric(e.target.value)} placeholder="Average prep minutes" />
          <Input label="Target" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="18" />
        </FieldGrid>
        <FieldGrid columns={2}>
          <Input label="Weight" type="number" min={1} max={100} value={weight} onChange={(e) => setWeight(Number(e.target.value) || 1)} hint="How much of the period this goal represents." />
          <Input label="Due (optional)" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </FieldGrid>
      </div>
    </Modal>
  );
}

export function ProgressDialog({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState(goal.progress);
  const [note, setNote] = useState("");

  const update = useMutation({
    mutationFn: async () => api.post(`/performance/goals/${goal.id}/progress`, { progress, note }),
    onSuccess: () => {
      toast.success(progress >= 100 ? "Goal completed" : "Progress saved");
      queryClient.invalidateQueries({ queryKey: ["performance", "goals"] });
      onClose();
    },
    onError: (error) => toast.fromError(error, "Could not save progress."),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={goal.title}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={update.isPending} onClick={() => update.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium text-[var(--text)]">Progress: {progress}%</label>
          <input type="range" min={0} max={100} step={5} value={progress} onChange={(e) => setProgress(Number(e.target.value))} className="mt-2 w-full" aria-label="Progress" />
          <div className="mt-2">
            <ProgressBar value={progress} />
          </div>
        </div>
        <Textarea label="What changed (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Two stations reorganised; timing down to 19 min." />
      </div>
    </Modal>
  );
}
