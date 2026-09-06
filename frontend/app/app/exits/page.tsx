"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DoorOpen, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useListQuery, useListState } from "@/lib/hooks";
import { formatDate, formatMoney, formatRelative, humanise } from "@/lib/format";
import { Badge, Button, Callout, Card, Drawer, EmptyState, FieldGrid, FilterSelect, Input, Modal, NoAccessState, PageHeader, Select, StatusBadge, Switch, TableToolbar, Textarea, useToast } from "@/components/ui";
import { TaskList, ProgressBar } from "@/components/modules/TaskList";
import { EmployeeMultiPicker } from "@/components/documents/EmployeePicker";
import type { EmployeeExit, LifecycleTask, SettlementLine } from "@/lib/lifecycleTypes";

const STATUS: Record<string, string> = { requested: "pending", accepted: "approved", in_progress: "processing", completed: "completed", rejected: "rejected", withdrawn: "cancelled", cancelled: "cancelled" };
const TYPES = ["resignation", "termination", "retirement", "end_of_contract", "absconded"];

/** Exits: resignations to decide, clearances in progress, settlements to file. */
export default function ExitsPage() {
  const { session, can, canAny } = useSession();
  const locale = session?.organization?.locale || "en-IN";
  const state = useListState();
  const [openId, setOpenId] = useState<string | null>(null);
  const [initiating, setInitiating] = useState(false);

  const { items, total, limit, isLoading, error } = useListQuery<EmployeeExit>("exits", "/exits", state, { limit: 30, extraQuery: { includeClosed: state.filters.status ? "true" : undefined }, enabled: canAny("exit.view", "exit.manage", "workflow.act") });

  if (!canAny("exit.view", "exit.manage", "workflow.act")) return <NoAccessState what="exits" />;

  return (
    <>
      <PageHeader
        title="Exits"
        description="Resignations to decide, clearances in progress, and settlements to file — through to the last working day."
        actions={
          can("exit.manage") && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setInitiating(true)}>
              Start an exit
            </Button>
          )
        }
      />

      <div className="mb-4">
        <TableToolbar
          filters={
            <>
              <FilterSelect value={state.filters.status || ""} onChange={(v) => state.setFilter("status", v)} placeholder="Open exits" options={["requested", "in_progress", "completed", "rejected", "withdrawn", "cancelled"].map((s) => ({ value: s, label: humanise(s) }))} />
              <FilterSelect value={state.filters.type || ""} onChange={(v) => state.setFilter("type", v)} placeholder="Any type" options={TYPES.map((t) => ({ value: t, label: humanise(t) }))} />
            </>
          }
          activeFilterCount={state.activeFilterCount}
          onClearFilters={state.clearFilters}
        />
      </div>

      {isLoading ? (
        <div className="skeleton h-40" />
      ) : error ? (
        <Card><EmptyState title="Could not load exits" description={(error as Error).message} /></Card>
      ) : !items.length ? (
        <Card><EmptyState icon={<DoorOpen className="h-6 w-6" />} title="No exits in progress" description="Resignations submitted by employees and exits you start appear here." /></Card>
      ) : (
        <Card padded={false}>
          <ul className="divide-y">
            {items.map((exit) => (
              <li key={exit.id}>
                <button type="button" onClick={() => setOpenId(exit.id)} className="flex w-full flex-wrap items-center gap-3 px-5 py-3.5 text-left hover:bg-[var(--surface-muted)]">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium text-[var(--text)]">
                      {exit.employee.name} <span className="text-[var(--text-subtle)]">({exit.employee.employeeCode})</span>
                    </p>
                    <p className="truncate text-[12.5px] text-[var(--text-muted)]">
                      {humanise(exit.type)}
                      {exit.employee.designation ? ` · ${exit.employee.designation}` : ""}
                      {exit.lastWorkingDay ? ` · last day ${formatDate(exit.lastWorkingDay, { locale })}` : exit.proposedLastDay ? ` · proposes ${formatDate(exit.proposedLastDay, { locale })}` : ""} · {formatRelative(exit.createdAt)}
                    </p>
                  </div>
                  {exit.status === "in_progress" && <div className="w-40"><ProgressBar {...exit.progress} /></div>}
                  {exit.noticeShortfallDays > 0 && exit.status !== "completed" && <Badge tone="warning">{exit.noticeShortfallDays} days short of notice</Badge>}
                  <StatusBadge status={STATUS[exit.status] || exit.status} label={humanise(exit.status)} />
                </button>
              </li>
            ))}
          </ul>
          {total > limit && <p className="border-t px-5 py-3 text-[12.5px] text-[var(--text-muted)]">Showing {items.length} of {total}.</p>}
        </Card>
      )}

      {openId && <ExitDrawer exitId={openId} onClose={() => setOpenId(null)} />}
      {initiating && <InitiateDialog onClose={() => setInitiating(false)} />}
    </>
  );
}

function ExitDrawer({ exitId, onClose }: { exitId: string; onClose: () => void }) {
  const { session, can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const locale = session?.organization?.locale || "en-IN";
  const currency = session?.organization?.currency || "INR";
  const [decision, setDecision] = useState<{ approve: boolean; lastWorkingDay: string; comment: string; noticeWaived: boolean } | null>(null);
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState({ lastWorkingDay: "", noticeWaived: false, isRehirable: true, exitInterviewNotes: "" });
  const [lines, setLines] = useState<{ dues: SettlementLine[]; recoveries: SettlementLine[] } | null>(null);

  const { data: exit } = useQuery({ queryKey: ["exits", exitId], queryFn: async () => (await api.get<EmployeeExit>(`/exits/${exitId}`)).data });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["exits"] });
    queryClient.invalidateQueries({ queryKey: ["employee"] });
  };
  const run = useMutation({
    mutationFn: async ({ path, body }: { path: string; body?: unknown }) => (await api.post(`/exits/${exitId}${path}`, body)).data,
    onSuccess: () => { refresh(); setDecision(null); },
    onError: (error) => toast.fromError(error, "That did not work."),
  });
  const patch = useMutation({
    mutationFn: async (body: unknown) => (await api.patch(`/exits/${exitId}`, body)).data,
    onSuccess: () => { toast.success("Saved"); setEditing(false); refresh(); },
    onError: (error) => toast.fromError(error, "Could not save."),
  });
  const saveLines = useMutation({
    mutationFn: async () => (await api.patch(`/exits/${exitId}/settlement`, lines)).data,
    onSuccess: () => { toast.success("Settlement updated"); setLines(null); refresh(); },
    onError: (error) => toast.fromError(error, "Could not save the settlement."),
  });

  const manage = can("exit.manage");

  return (
    <Drawer open onClose={onClose} title={exit ? `${exit.employee.name} · ${humanise(exit.type)}` : "Exit"} width="lg">
      {!exit ? (
        <div className="skeleton h-40" />
      ) : (
        <div className="space-y-5 text-[13.5px]">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={STATUS[exit.status] || exit.status} label={humanise(exit.status)} />
            <Link href={`/app/employees/${exit.employee.id}`} className="text-brand-700 hover:underline">
              Open profile
            </Link>
            <span className="text-[var(--text-muted)]">
              {exit.initiatedBy === "employee" ? "Resigned" : "Started by HR"} {formatRelative(exit.createdAt)}
              {exit.decidedBy ? ` · decided by ${exit.decidedBy}` : ""}
            </span>
          </div>
          {exit.reason && <p className="rounded-md border bg-[var(--surface-muted)] p-3">{exit.reason}</p>}

          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
            {[
              ["Resigned on", exit.resignationDate ? formatDate(exit.resignationDate, { locale }) : "—"],
              ["Proposed last day", exit.proposedLastDay ? formatDate(exit.proposedLastDay, { locale }) : "—"],
              ["Last working day", exit.lastWorkingDay ? formatDate(exit.lastWorkingDay, { locale }) : "not set"],
              ["Notice period", exit.noticePeriodDays ? `${exit.noticePeriodDays} days${exit.noticeWaived ? " (waived)" : ""}` : "—"],
              ["Shortfall", exit.noticeShortfallDays ? `${exit.noticeShortfallDays} days` : "none"],
              ["Rehirable", exit.isRehirable === false ? "No" : "Yes"],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[11px] uppercase tracking-wider text-[var(--text-subtle)]">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>

          {exit.status === "requested" && manage && (
            <div className="space-y-3 rounded-md border p-3">
              <p className="font-medium">Decide this resignation</p>
              {!decision ? (
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setDecision({ approve: false, lastWorkingDay: "", comment: "", noticeWaived: false })}>Decline</Button>
                  <Button onClick={() => setDecision({ approve: true, lastWorkingDay: exit.proposedLastDay || "", comment: "", noticeWaived: false })}>Accept</Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {decision.approve && (
                    <>
                      <Input label="Last working day" type="date" value={decision.lastWorkingDay} onChange={(e) => setDecision({ ...decision, lastWorkingDay: e.target.value })} />
                      <Switch label="Waive the notice period shortfall" checked={decision.noticeWaived} onChange={(v) => setDecision({ ...decision, noticeWaived: v })} />
                    </>
                  )}
                  <Textarea label={decision.approve ? "Note (optional)" : "Reason"} rows={2} value={decision.comment} onChange={(e) => setDecision({ ...decision, comment: e.target.value })} />
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => setDecision(null)}>Cancel</Button>
                    <Button size="sm" loading={run.isPending} onClick={() => run.mutate({ path: "/decide", body: { decision: decision.approve ? "approve" : "reject", lastWorkingDay: decision.lastWorkingDay || undefined, comment: decision.comment, noticeWaived: decision.noticeWaived } })}>
                      {decision.approve ? "Accept resignation" : "Decline"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {exit.status === "in_progress" && (
            <>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-medium">Clearance</p>
                  <div className="w-48"><ProgressBar {...exit.progress} /></div>
                </div>
                <TaskList
                  tasks={exit.tasks}
                  locale={locale}
                  canComplete={(task) => manage || task.assigneeUserId === session?.user.id}
                  showRecovery={manage}
                  busy={run.isPending}
                  onComplete={(task: LifecycleTask, input) => run.mutate({ path: `/tasks/${task.id}/complete`, body: input })}
                />
                {manage && <AddTask onAdd={(body) => run.mutate({ path: "/tasks", body })} />}
              </div>

              <div className="space-y-3 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <p className="font-medium">Full and final settlement</p>
                  {manage && !exit.settlement?.settledAt && (
                    <Button size="sm" variant="outline" loading={run.isPending} onClick={() => run.mutate({ path: "/settlement/compute" })}>
                      {exit.settlement ? "Recompute" : "Compute"}
                    </Button>
                  )}
                </div>
                {!exit.settlement ? (
                  <p className="text-[12.5px] text-[var(--text-muted)]">Computed from the final month's salary, encashable leave, notice shortfall, loans and clearance recoveries.</p>
                ) : (
                  <>
                    <SettlementTable title="Dues" rows={lines ? lines.dues : exit.settlement.dues} currency={currency} locale={locale} editable={Boolean(lines)} onChange={(rows) => lines && setLines({ ...lines, dues: rows })} />
                    <SettlementTable title="Recoveries" rows={lines ? lines.recoveries : exit.settlement.recoveries} currency={currency} locale={locale} editable={Boolean(lines)} onChange={(rows) => lines && setLines({ ...lines, recoveries: rows })} />
                    <p className="text-right font-semibold">
                      Net {formatMoney((lines ? lines.dues.reduce((s, d) => s + d.amount, 0) - lines.recoveries.reduce((s, d) => s + d.amount, 0) : exit.settlement.net), { currency, locale })}
                    </p>
                    {exit.settlement.settledAt ? (
                      <Callout tone="success">Filed with payroll {formatRelative(exit.settlement.settledAt)}. It lands on the next processed run.</Callout>
                    ) : manage ? (
                      <div className="flex justify-end gap-2">
                        {lines ? (
                          <>
                            <Button size="sm" variant="outline" onClick={() => setLines(null)}>Cancel</Button>
                            <Button size="sm" loading={saveLines.isPending} onClick={() => saveLines.mutate()}>Save lines</Button>
                          </>
                        ) : (
                          <>
                            <Button size="sm" variant="outline" onClick={() => setLines({ dues: exit.settlement!.dues.map((d) => ({ ...d })), recoveries: exit.settlement!.recoveries.map((d) => ({ ...d })) })}>Edit lines</Button>
                            <Button size="sm" loading={run.isPending} onClick={() => run.mutate({ path: "/settlement/settle", body: { generateDocument: true } })}>File with payroll + statement</Button>
                          </>
                        )}
                      </div>
                    ) : null}
                  </>
                )}
              </div>

              {manage && (
                <div className="flex flex-wrap justify-between gap-2 border-t pt-4">
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setEdit({ lastWorkingDay: exit.lastWorkingDay || "", noticeWaived: exit.noticeWaived, isRehirable: exit.isRehirable !== false, exitInterviewNotes: exit.exitInterviewNotes || "" }); setEditing(true); }}>Edit dates & notes</Button>
                    <Button variant="ghost" size="sm" onClick={() => run.mutate({ path: "/withdraw" })}>Cancel exit</Button>
                  </div>
                  <Button loading={run.isPending} disabled={exit.progress.done < exit.progress.total} title={exit.progress.done < exit.progress.total ? "Finish the clearance first" : undefined} onClick={() => run.mutate({ path: "/complete", body: { generateLetters: true } })}>
                    Complete exit + letters
                  </Button>
                </div>
              )}
            </>
          )}

          {exit.status === "completed" && <Callout tone="success">Completed {exit.completedAt ? formatRelative(exit.completedAt) : ""}. Relieving and experience letters are in the employee's documents.</Callout>}

          <Modal open={editing} onClose={() => setEditing(false)} title="Edit exit" size="sm" footer={<><Button variant="outline" onClick={() => setEditing(false)}>Cancel</Button><Button loading={patch.isPending} onClick={() => patch.mutate({ ...edit, lastWorkingDay: edit.lastWorkingDay || undefined })}>Save</Button></>}>
            <div className="space-y-3">
              <Input label="Last working day" type="date" value={edit.lastWorkingDay} onChange={(e) => setEdit({ ...edit, lastWorkingDay: e.target.value })} />
              <Switch label="Notice period waived" checked={edit.noticeWaived} onChange={(v) => setEdit({ ...edit, noticeWaived: v })} />
              <Switch label="Eligible for rehire" checked={edit.isRehirable} onChange={(v) => setEdit({ ...edit, isRehirable: v })} />
              <Textarea label="Exit interview notes" rows={4} value={edit.exitInterviewNotes} onChange={(e) => setEdit({ ...edit, exitInterviewNotes: e.target.value })} />
            </div>
          </Modal>
        </div>
      )}
    </Drawer>
  );
}

function SettlementTable({ title, rows, currency, locale, editable, onChange }: { title: string; rows: SettlementLine[]; currency: string; locale: string; editable: boolean; onChange: (rows: SettlementLine[]) => void }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-subtle)]">{title}</p>
      {!rows.length && <p className="text-[12.5px] text-[var(--text-muted)]">None.</p>}
      <table className="w-full text-[13px]">
        <tbody className="divide-y">
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="py-1 pr-2">{editable ? <Input value={r.label} onChange={(e) => onChange(rows.map((x, idx) => (idx === i ? { ...x, label: e.target.value } : x)))} /> : r.label}</td>
              <td className="py-1 pr-2 text-[var(--text-muted)]">{editable ? <Input value={r.detail || ""} onChange={(e) => onChange(rows.map((x, idx) => (idx === i ? { ...x, detail: e.target.value } : x)))} /> : r.detail}</td>
              <td className="py-1 text-right tabular-nums">{editable ? <Input type="number" value={r.amount} onChange={(e) => onChange(rows.map((x, idx) => (idx === i ? { ...x, amount: Number(e.target.value) } : x)))} /> : formatMoney(r.amount, { currency, locale })}</td>
              {editable && <td className="py-1 pl-2"><Button variant="ghost" size="sm" onClick={() => onChange(rows.filter((_, idx) => idx !== i))}>×</Button></td>}
            </tr>
          ))}
        </tbody>
      </table>
      {editable && <Button variant="outline" size="sm" className="mt-1" onClick={() => onChange([...rows, { label: "", detail: "", amount: 0 }])}>Add line</Button>}
    </div>
  );
}

function AddTask({ onAdd }: { onAdd: (body: { title: string; owner: string }) => void }) {
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState("hr");
  return (
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <Input placeholder="Add a clearance task" value={title} onChange={(e) => setTitle(e.target.value)} containerClassName="flex-1 min-w-[12rem]" />
      <Select value={owner} onChange={(e) => setOwner(e.target.value)} options={["hr", "it", "finance", "admin", "manager", "employee"].map((o) => ({ value: o, label: o.toUpperCase() }))} className="w-32" />
      <Button size="sm" variant="outline" disabled={!title.trim()} onClick={() => { onAdd({ title, owner }); setTitle(""); }}>Add</Button>
    </div>
  );
}

function InitiateDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [form, setForm] = useState({ type: "termination", lastWorkingDay: "", reason: "", noticeWaived: false, isRehirable: true });
  const start = useMutation({
    mutationFn: async () => (await api.post("/exits", { employeeId: selected[0], ...form })).data,
    onSuccess: () => { toast.success("Exit started", "Clearance tasks have been assigned."); queryClient.invalidateQueries({ queryKey: ["exits"] }); onClose(); },
    onError: (error) => toast.fromError(error, "Could not start the exit."),
  });
  return (
    <Modal open onClose={onClose} title="Start an exit" size="md" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={start.isPending} disabled={!selected.length || !form.lastWorkingDay} onClick={() => start.mutate()}>Start</Button></>}>
      <div className="space-y-4">
        <EmployeeMultiPicker selected={selected} onChange={(ids) => setSelected(ids.slice(-1))} maxHeight="12rem" />
        <FieldGrid columns={2}>
          <Select label="Type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} options={TYPES.map((t) => ({ value: t, label: humanise(t) }))} />
          <Input label="Last working day" type="date" value={form.lastWorkingDay} onChange={(e) => setForm({ ...form, lastWorkingDay: e.target.value })} required />
        </FieldGrid>
        <Textarea label="Reason" rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
        <Switch label="Notice period waived" checked={form.noticeWaived} onChange={(v) => setForm({ ...form, noticeWaived: v })} />
        <Switch label="Eligible for rehire" checked={form.isRehirable} onChange={(v) => setForm({ ...form, isRehirable: v })} />
      </div>
    </Modal>
  );
}
