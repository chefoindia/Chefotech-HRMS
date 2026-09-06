"use client";

import { useState } from "react";
import { CheckCircle2, Circle, MinusCircle } from "lucide-react";
import { formatDate, formatRelative } from "@/lib/format";
import { Badge, Button, Input } from "@/components/ui";
import { OWNER_LABELS, type LifecycleTask } from "@/lib/lifecycleTypes";

/** A checklist with per-task owner, due date and a way to tick it. */
export function TaskList({
  tasks,
  locale,
  canComplete,
  onComplete,
  showRecovery,
  busy,
}: {
  tasks: LifecycleTask[];
  locale: string;
  canComplete: (task: LifecycleTask) => boolean;
  onComplete: (task: LifecycleTask, input: { status: "done" | "skipped"; note: string; recoveryAmount?: number }) => void;
  showRecovery?: boolean;
  busy?: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [recovery, setRecovery] = useState("");

  return (
    <ul className="divide-y rounded-md border">
      {tasks.map((task) => {
        const done = task.status !== "pending";
        return (
          <li key={task.id} className="px-3 py-2.5">
            <div className="flex items-start gap-3">
              {task.status === "done" ? <CheckCircle2 className="mt-0.5 h-4.5 w-4.5 shrink-0 text-[var(--success)]" aria-hidden /> : task.status === "skipped" ? <MinusCircle className="mt-0.5 h-4.5 w-4.5 shrink-0 text-[var(--text-subtle)]" aria-hidden /> : <Circle className="mt-0.5 h-4.5 w-4.5 shrink-0 text-[var(--text-subtle)]" aria-hidden />}
              <div className="min-w-0 flex-1">
                <p className={`text-[13.5px] ${done ? "text-[var(--text-muted)] line-through" : "font-medium text-[var(--text)]"}`}>{task.title}</p>
                <p className="text-[12px] text-[var(--text-muted)]">
                  {OWNER_LABELS[task.owner] || task.owner}
                  {task.assignee ? ` · ${task.assignee}` : " · unassigned"}
                  {task.dueOn ? ` · due ${formatDate(task.dueOn, { locale })}` : ""}
                  {done && task.completedAt ? ` · ${task.status} ${formatRelative(task.completedAt)}${task.completedBy ? ` by ${task.completedBy}` : ""}` : ""}
                  {task.note ? ` — ${task.note}` : ""}
                  {task.recoveryAmount ? ` · recovery ${task.recoveryAmount}` : ""}
                </p>
                {task.description && !done && <p className="mt-0.5 text-[12px] text-[var(--text-subtle)]">{task.description}</p>}
              </div>
              {task.isOverdue && !done && <Badge tone="danger">Overdue</Badge>}
              {!done && canComplete(task) && (
                <Button size="sm" variant={open === task.id ? "ghost" : "outline"} onClick={() => setOpen(open === task.id ? null : task.id)}>
                  {open === task.id ? "Cancel" : "Mark done"}
                </Button>
              )}
            </div>
            {open === task.id && (
              <div className="mt-2 flex flex-wrap items-end gap-2 pl-7">
                <Input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} containerClassName="flex-1 min-w-[12rem]" />
                {showRecovery && <Input type="number" min={0} placeholder="Recover amount" value={recovery} onChange={(e) => setRecovery(e.target.value)} containerClassName="w-40" />}
                <Button size="sm" variant="outline" loading={busy} onClick={() => { onComplete(task, { status: "skipped", note }); setOpen(null); setNote(""); setRecovery(""); }}>
                  Skip
                </Button>
                <Button size="sm" loading={busy} onClick={() => { onComplete(task, { status: "done", note, recoveryAmount: recovery ? Number(recovery) : undefined }); setOpen(null); setNote(""); setRecovery(""); }}>
                  Done
                </Button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function ProgressBar({ done, total, percent }: { done: number; total: number; percent: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--surface-sunken)]">
        <div className="h-full bg-[var(--success)] transition-all" style={{ width: `${percent}%` }} />
      </div>
      <span className="shrink-0 text-[12px] text-[var(--text-muted)]">
        {done} / {total}
      </span>
    </div>
  );
}
