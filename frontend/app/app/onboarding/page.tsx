"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListChecks, Plus, Sparkles, UserPlus } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatDate, formatRelative, humanise } from "@/lib/format";
import { Badge, Button, Card, CardHeader, Checkbox, Drawer, EmptyState, FieldGrid, Input, Modal, NoAccessState, PageHeader, Select, Tabs, Textarea, useToast } from "@/components/ui";
import { TaskList, ProgressBar } from "@/components/modules/TaskList";
import { EmployeeMultiPicker } from "@/components/documents/EmployeePicker";
import { OWNER_LABELS, type LifecycleTask, type MyTask, type Onboarding, type OnboardingTemplate } from "@/lib/lifecycleTypes";

/** Onboarding: joiners in progress, my tasks, and the checklist templates. */
export default function OnboardingPage() {
  const { session, can, canAny } = useSession();
  const locale = session?.organization?.locale || "en-IN";
  const [tab, setTab] = useState("joiners");
  const [openId, setOpenId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const joiners = useQuery({ queryKey: ["onboarding", "list"], queryFn: async () => (await api.get<Onboarding[]>("/onboarding", { query: { limit: 100 } })).data, enabled: canAny("onboarding.view", "onboarding.manage", "employee.view") });
  const myTasks = useQuery({ queryKey: ["onboarding", "my-tasks"], queryFn: async () => (await api.get<MyTask[]>("/onboarding/tasks/me")).data });

  if (!canAny("onboarding.view", "onboarding.manage", "employee.view")) return <NoAccessState what="onboarding" />;

  return (
    <>
      <PageHeader
        title="Onboarding"
        description="Every new joiner's checklist — who owes what, by when — so nobody arrives to no laptop and no login."
        actions={
          can("onboarding.manage") && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setStarting(true)}>
              Start for an employee
            </Button>
          )
        }
      />
      <Tabs
        items={[
          { key: "joiners", label: "Joiners", count: joiners.data?.length },
          { key: "mine", label: "My tasks", count: myTasks.data?.length },
          ...(can("onboarding.manage") ? [{ key: "templates", label: "Checklists" }] : []),
        ]}
        active={tab}
        onChange={setTab}
        className="mb-5"
      />

      {tab === "joiners" &&
        (joiners.isLoading ? (
          <div className="skeleton h-40" />
        ) : !joiners.data?.length ? (
          <Card><EmptyState icon={<UserPlus className="h-6 w-6" />} title="No joiners in progress" description="Adding an employee opens their checklist automatically. You can also start one by hand." /></Card>
        ) : (
          <Card padded={false}>
            <ul className="divide-y">
              {joiners.data.map((o) => (
                <li key={o.id}>
                  <button type="button" onClick={() => setOpenId(o.id)} className="flex w-full flex-wrap items-center gap-3 px-5 py-3.5 text-left hover:bg-[var(--surface-muted)]">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium text-[var(--text)]">
                        {o.employee.name} <span className="text-[var(--text-subtle)]">({o.employee.employeeCode})</span>
                      </p>
                      <p className="truncate text-[12.5px] text-[var(--text-muted)]">
                        {o.employee.designation || "—"}
                        {o.employee.department ? ` · ${o.employee.department}` : ""} · joins {o.joiningDate ? formatDate(o.joiningDate, { locale }) : "—"} · {o.templateName}
                      </p>
                    </div>
                    {o.progress.overdue ? <Badge tone="danger">{o.progress.overdue} overdue</Badge> : null}
                    <div className="w-44"><ProgressBar {...o.progress} /></div>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        ))}

      {tab === "mine" && <MyTasksList tasks={myTasks.data || []} locale={locale} onOpen={setOpenId} />}
      {tab === "templates" && <TemplatesPanel />}

      {openId && <OnboardingDrawer onboardingId={openId} onClose={() => setOpenId(null)} />}
      {starting && <StartDialog onClose={() => setStarting(false)} />}
    </>
  );
}

function MyTasksList({ tasks, locale, onOpen }: { tasks: MyTask[]; locale: string; onOpen: (id: string) => void }) {
  if (!tasks.length) return <Card><EmptyState icon={<ListChecks className="h-6 w-6" />} title="Nothing on your list" description="Joining tasks assigned to you appear here." /></Card>;
  return (
    <Card padded={false}>
      <ul className="divide-y">
        {tasks.map((t) => (
          <li key={t.taskId}>
            <button type="button" onClick={() => onOpen(t.onboardingId!)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-[var(--surface-muted)]">
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium text-[var(--text)]">{t.title}</p>
                <p className="text-[12.5px] text-[var(--text-muted)]">
                  for {t.employee.name} · {t.dueOn ? `due ${formatDate(t.dueOn, { locale })}` : "no due date"}
                </p>
              </div>
              {t.isOverdue && <Badge tone="danger">Overdue</Badge>}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function OnboardingDrawer({ onboardingId, onClose }: { onboardingId: string; onClose: () => void }) {
  const { session, can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const locale = session?.organization?.locale || "en-IN";
  const [newTask, setNewTask] = useState({ title: "", owner: "hr", dueOn: "" });
  const { data: o } = useQuery({ queryKey: ["onboarding", onboardingId], queryFn: async () => (await api.get<Onboarding>(`/onboarding/${onboardingId}`)).data });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["onboarding"] });
  const run = useMutation({
    mutationFn: async ({ path, body }: { path: string; body?: unknown }) => (await api.post(`/onboarding/${onboardingId}${path}`, body)).data,
    onSuccess: refresh,
    onError: (error) => toast.fromError(error, "That did not work."),
  });
  const manage = can("onboarding.manage");

  return (
    <Drawer open onClose={onClose} title={o ? `${o.employee.name} · ${o.templateName}` : "Onboarding"} width="lg">
      {!o ? (
        <div className="skeleton h-40" />
      ) : (
        <div className="space-y-5 text-[13.5px]">
          <div className="flex flex-wrap items-center gap-3">
            <Link href={`/app/employees/${o.employee.id}`} className="text-brand-700 hover:underline">Open profile</Link>
            <span className="text-[var(--text-muted)]">joins {o.joiningDate ? formatDate(o.joiningDate, { locale }) : "—"} · started {formatRelative(o.createdAt)}</span>
            {o.status === "completed" && <Badge tone="success">Completed</Badge>}
            {!o.employee.hasPortalAccount && <Badge tone="warning">No portal account yet</Badge>}
          </div>
          <ProgressBar {...o.progress} />
          {o.welcomeNote && <p className="rounded-md border bg-[var(--surface-muted)] p-3">{o.welcomeNote}</p>}
          <TaskList tasks={o.tasks} locale={locale} canComplete={(task) => manage || task.assigneeUserId === session?.user.id} busy={run.isPending} onComplete={(task: LifecycleTask, input) => run.mutate({ path: `/tasks/${task.id}/complete`, body: input })} />
          {manage && o.status === "in_progress" && (
            <div className="flex flex-wrap items-end gap-2">
              <Input placeholder="Add a task" value={newTask.title} onChange={(e) => setNewTask({ ...newTask, title: e.target.value })} containerClassName="flex-1 min-w-[12rem]" />
              <Select value={newTask.owner} onChange={(e) => setNewTask({ ...newTask, owner: e.target.value })} options={Object.entries(OWNER_LABELS).map(([v, l]) => ({ value: v, label: l }))} className="w-32" />
              <Input type="date" value={newTask.dueOn} onChange={(e) => setNewTask({ ...newTask, dueOn: e.target.value })} containerClassName="w-40" />
              <Button size="sm" variant="outline" disabled={!newTask.title.trim()} onClick={() => { run.mutate({ path: "/tasks", body: { ...newTask, dueOn: newTask.dueOn || undefined } }); setNewTask({ title: "", owner: "hr", dueOn: "" }); }}>Add</Button>
            </div>
          )}
          {manage && o.status === "in_progress" && (
            <div className="flex justify-between border-t pt-3">
              <Button variant="ghost" size="sm" onClick={() => run.mutate({ path: "/cancel" })}>Cancel onboarding</Button>
              <Button variant="outline" size="sm" icon={<Sparkles className="h-3.5 w-3.5" />} onClick={() => api.post("/onboarding/run-auto").then(refresh)}>Check auto-completions</Button>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

function StartDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [welcomeNote, setWelcomeNote] = useState("");
  const { data: templates } = useQuery({ queryKey: ["onboarding", "templates"], queryFn: async () => (await api.get<OnboardingTemplate[]>("/onboarding/templates")).data });
  const start = useMutation({
    mutationFn: async () => (await api.post("/onboarding", { employeeId: selected[0], templateId: templateId || undefined, welcomeNote })).data,
    onSuccess: () => { toast.success("Onboarding started", "Everyone with a task has been told."); queryClient.invalidateQueries({ queryKey: ["onboarding"] }); onClose(); },
    onError: (error) => toast.fromError(error, "Could not start onboarding."),
  });
  return (
    <Modal open onClose={onClose} title="Start onboarding" size="md" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={start.isPending} disabled={!selected.length} onClick={() => start.mutate()}>Start</Button></>}>
      <div className="space-y-4">
        <EmployeeMultiPicker selected={selected} onChange={(ids) => setSelected(ids.slice(-1))} maxHeight="12rem" />
        <Select label="Checklist" value={templateId} onChange={(e) => setTemplateId(e.target.value)} placeholder="Pick automatically" options={(templates || []).map((t) => ({ value: t.id, label: `${t.name}${t.isDefault ? " (default)" : ""}` }))} />
        <Textarea label="Welcome note (optional)" rows={2} value={welcomeNote} onChange={(e) => setWelcomeNote(e.target.value)} placeholder="Shown to the joiner on their first day." />
      </div>
    </Modal>
  );
}

function TemplatesPanel() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<OnboardingTemplate | "new" | null>(null);
  const { data: templates, isLoading } = useQuery({ queryKey: ["onboarding", "templates"], queryFn: async () => (await api.get<OnboardingTemplate[]>("/onboarding/templates")).data });
  const seed = useMutation({
    mutationFn: async () => (await api.post<{ created: number }>("/onboarding/templates/seed-default")).data,
    onSuccess: (r) => { toast.success(r.created ? "Standard checklist added" : "Already present"); queryClient.invalidateQueries({ queryKey: ["onboarding", "templates"] }); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/onboarding/templates/${id}`),
    onSuccess: () => { toast.success("Checklist removed"); queryClient.invalidateQueries({ queryKey: ["onboarding", "templates"] }); },
    onError: (error) => toast.fromError(error, "Could not remove it."),
  });

  return (
    <>
      <div className="mb-4 flex justify-end gap-2">
        {!templates?.length && <Button variant="outline" icon={<Sparkles className="h-4 w-4" />} loading={seed.isPending} onClick={() => seed.mutate()}>Add the standard checklist</Button>}
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing("new")}>New checklist</Button>
      </div>
      {isLoading ? (
        <div className="skeleton h-32" />
      ) : !templates?.length ? (
        <Card><EmptyState icon={<ListChecks className="h-6 w-6" />} title="No checklists yet" description="Start from the standard ten-task checklist and change it to match how your company welcomes people." action={<Button loading={seed.isPending} onClick={() => seed.mutate()}>Add the standard checklist</Button>} /></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {templates.map((t) => (
            <Card key={t.id}>
              <CardHeader title={<>{t.name} {t.isDefault && <Badge tone="brand" className="ml-2">Default</Badge>}</>} description={`${t.tasks.length} tasks${t.appliesTo.departmentIds.length ? ` · ${t.appliesTo.departmentIds.length} department(s)` : ""}${t.appliesTo.employmentTypes.length ? ` · ${t.appliesTo.employmentTypes.map(humanise).join(", ")}` : ""}`} />
              <ul className="mt-3 space-y-1 text-[12.5px] text-[var(--text-muted)]">
                {t.tasks.slice(0, 5).map((x, i) => (
                  <li key={x.id || i}>• {x.title} <span className="text-[var(--text-subtle)]">({OWNER_LABELS[x.owner]}, day {x.dueOffsetDays >= 0 ? `+${x.dueOffsetDays}` : x.dueOffsetDays})</span></li>
                ))}
                {t.tasks.length > 5 && <li>… and {t.tasks.length - 5} more</li>}
              </ul>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditing(t)}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => remove.mutate(t.id)}>Remove</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {editing && <TemplateDialog template={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function TemplateDialog({ template, onClose }: { template: OnboardingTemplate | null; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState(template?.name || "");
  const [description, setDescription] = useState(template?.description || "");
  const [isDefault, setIsDefault] = useState(template?.isDefault || false);
  const [tasks, setTasks] = useState(template?.tasks.map((t) => ({ ...t })) || [{ title: "", description: "", owner: "hr" as const, dueOffsetDays: 0, autoComplete: "" }]);
  const save = useMutation({
    mutationFn: async () => {
      const body = { name, description, isDefault, tasks: tasks.filter((t) => t.title.trim()).map(({ id, ...t }) => { void id; return t; }) };
      if (template) await api.patch(`/onboarding/templates/${template.id}`, body);
      else await api.post("/onboarding/templates", body);
    },
    onSuccess: () => { toast.success("Checklist saved"); queryClient.invalidateQueries({ queryKey: ["onboarding", "templates"] }); onClose(); },
    onError: (error) => toast.fromError(error, "Could not save the checklist."),
  });
  const setTask = (i: number, patch: Partial<(typeof tasks)[number]>) => setTasks(tasks.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));

  return (
    <Modal open onClose={onClose} title={template ? `Edit ${template.name}` : "New checklist"} size="lg" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>Save</Button></>}>
      <div className="space-y-4">
        <FieldGrid columns={2}>
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <div className="flex items-end pb-2"><Checkbox label="Use for every joiner by default" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} /></div>
        </FieldGrid>
        <Input label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
        <div className="space-y-2">
          <p className="text-[13px] font-medium">Tasks</p>
          {tasks.map((t, i) => (
            <div key={i} className="grid gap-2 rounded-md border p-2 sm:grid-cols-[1fr_7rem_6rem_10rem_auto]">
              <Input placeholder="Task" value={t.title} onChange={(e) => setTask(i, { title: e.target.value })} />
              <Select value={t.owner} onChange={(e) => setTask(i, { owner: e.target.value as LifecycleTask["owner"] })} options={Object.entries(OWNER_LABELS).map(([v, l]) => ({ value: v, label: l }))} />
              <Input type="number" value={t.dueOffsetDays} onChange={(e) => setTask(i, { dueOffsetDays: Number(e.target.value) })} aria-label="Days from joining" title="Days relative to the joining date; negative is before" />
              <Select value={t.autoComplete || ""} onChange={(e) => setTask(i, { autoComplete: e.target.value })} options={[{ value: "", label: "Manual" }, { value: "portal_invited", label: "Auto: portal invited" }, { value: "documents_verified", label: "Auto: ID verified" }, { value: "assets_assigned", label: "Auto: asset assigned" }, { value: "policies_acknowledged", label: "Auto: policies read" }, { value: "bank_details", label: "Auto: bank details" }]} />
              <Button variant="ghost" size="sm" onClick={() => setTasks(tasks.filter((_, idx) => idx !== i))}>×</Button>
            </div>
          ))}
          <Button variant="outline" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setTasks([...tasks, { title: "", description: "", owner: "hr", dueOffsetDays: 0, autoComplete: "" }])}>Add task</Button>
          <p className="text-[12px] text-[var(--text-subtle)]">Days are relative to the joining date: −2 is two days before, 30 is the 30-day check-in. Auto tasks tick themselves when the platform sees it done.</p>
        </div>
      </div>
    </Modal>
  );
}
