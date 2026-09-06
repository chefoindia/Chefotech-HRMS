"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useReferenceData } from "@/lib/hooks";
import { formatDate, formatRelative, humanise, todayString } from "@/lib/format";
import { Badge, Button, Callout, Card, CardHeader, EmptyState, FieldGrid, Input, Modal, Select, StatusBadge, Switch, Textarea, useToast } from "@/components/ui";
import { useEmployeeOptions } from "@/components/documents/EmployeePicker";
import type { EmployeeChange } from "@/lib/lifecycleTypes";

const TYPES = [
  { value: "promotion", label: "Promotion" },
  { value: "transfer", label: "Transfer" },
  { value: "designation", label: "Designation change" },
  { value: "department", label: "Department change" },
  { value: "manager", label: "New reporting manager" },
  { value: "location", label: "Location change" },
  { value: "shift", label: "Shift change" },
  { value: "employment_type", label: "Employment type" },
  { value: "work_mode", label: "Work mode" },
  { value: "confirmation", label: "Confirm probation" },
  { value: "probation_extension", label: "Extend probation" },
];

const STATUS: Record<string, string> = { scheduled: "pending", applied: "completed", cancelled: "cancelled", failed: "rejected" };

/** Movements on one employee: what changed when, and record the next one. */
export function EmployeeChangesPanel({ employeeId, locale }: { employeeId: string; locale: string }) {
  const { can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [recording, setRecording] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ["employee", employeeId, "changes"], queryFn: async () => (await api.get<EmployeeChange[]>(`/employees/${employeeId}/changes`)).data });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/employees/${employeeId}/changes/${id}/cancel`),
    onSuccess: () => { toast.success("Cancelled"); queryClient.invalidateQueries({ queryKey: ["employee", employeeId] }); },
    onError: (error) => toast.fromError(error, "Could not cancel it."),
  });

  return (
    <Card>
      <CardHeader
        title="Movements"
        description="Promotions, transfers, confirmations — each with an effective date. Future-dated ones apply themselves on the day."
        action={can("employee.update") && <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setRecording(true)}>Record a change</Button>}
      />
      {isLoading ? (
        <div className="skeleton mt-4 h-24" />
      ) : !data?.length ? (
        <EmptyState icon={<ArrowUpRight className="h-5 w-5" />} title="No movements yet" description="Promotions, transfers and probation confirmations recorded here also generate the matching letter." className="mt-4" />
      ) : (
        <ul className="mt-4 divide-y">
          {data.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium text-[var(--text)]">
                  {TYPES.find((t) => t.value === c.type)?.label || humanise(c.type)} · effective {formatDate(c.effectiveDate, { locale })}
                </p>
                <p className="text-[12.5px] text-[var(--text-muted)]">
                  {describeChanges(c)}
                  {c.reason ? ` · ${c.reason}` : ""}
                  {c.recordedBy ? ` · recorded by ${c.recordedBy} ${formatRelative(c.createdAt)}` : ""}
                  {c.salaryRevision ? ` · CTC ${c.salaryRevision.ctcAnnual}` : ""}
                </p>
                {c.error && <p className="text-[12px] text-[var(--danger)]">{c.error}</p>}
              </div>
              {c.letterDocumentId && <Badge tone="info">Letter generated</Badge>}
              <StatusBadge status={STATUS[c.status] || c.status} label={humanise(c.status)} />
              {c.status === "scheduled" && can("employee.update") && (
                <Button variant="ghost" size="sm" onClick={() => cancel.mutate(c.id)}>Cancel</Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {recording && <RecordChangeDialog employeeId={employeeId} onClose={() => setRecording(false)} />}
    </Card>
  );
}

function describeChanges(c: EmployeeChange) {
  const keys = Object.keys(c.changes || {});
  if (!keys.length) return "";
  return keys.map((k) => humanise(k.replace(/Id$/, ""))).join(", ");
}

function RecordChangeDialog({ employeeId, onClose }: { employeeId: string; onClose: () => void }) {
  const { can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { departments, designations, locations, shifts } = useReferenceData();
  const { employees } = useEmployeeOptions();
  const [type, setType] = useState("promotion");
  const [effectiveDate, setEffectiveDate] = useState(todayString());
  const [changes, setChanges] = useState<Record<string, string | number | null>>({});
  const [reason, setReason] = useState("");
  const [generateLetter, setGenerateLetter] = useState(true);
  const [ctcAnnual, setCtcAnnual] = useState("");
  const [structureId, setStructureId] = useState("");
  const { data: structures } = useQuery({ queryKey: ["payroll", "structures", "picker"], queryFn: async () => (await api.get<Array<{ id: string; name: string }>>("/payroll/structures", { query: { limit: 100 } })).data, enabled: can("payroll.assign_salary") });

  const set = (key: string, value: string | number | null) => setChanges((c) => ({ ...c, [key]: value }));
  const save = useMutation({
    mutationFn: async () =>
      (await api.post(`/employees/${employeeId}/changes`, {
        type,
        effectiveDate,
        changes: Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== "" && v !== undefined)),
        reason,
        generateLetter,
        salaryRevision: ctcAnnual && structureId ? { structureId, ctcAnnual: Number(ctcAnnual) } : undefined,
      })).data,
    onSuccess: (data: unknown) => {
      const status = (data as { status?: string })?.status;
      toast.success(status === "applied" ? "Applied" : "Scheduled", status === "applied" ? "The record is updated and the employee has been told." : `It applies on ${effectiveDate}.`);
      queryClient.invalidateQueries({ queryKey: ["employee", employeeId] });
      onClose();
    },
    onError: (error) => toast.fromError(error, "Could not record the change."),
  });

  const showsDesignation = ["promotion", "designation"].includes(type);
  const showsDepartment = ["transfer", "department", "promotion"].includes(type);
  const showsLocation = ["transfer", "location"].includes(type);
  const showsManager = ["transfer", "manager", "promotion"].includes(type);

  return (
    <Modal open onClose={onClose} title="Record a change" size="md" footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Record</Button></>}>
      <div className="space-y-4">
        <FieldGrid columns={2}>
          <Select label="What is changing" value={type} onChange={(e) => { setType(e.target.value); setChanges({}); }} options={TYPES} />
          <Input label="Effective from" type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} hint="A future date is applied on the day." />
        </FieldGrid>
        <FieldGrid columns={2}>
          {showsDesignation && <Select label="New designation" value={(changes.designationId as string) || ""} onChange={(e) => set("designationId", e.target.value)} placeholder="Choose" options={designations.map((d) => ({ value: d.id, label: d.name }))} />}
          {showsDepartment && <Select label="New department" value={(changes.departmentId as string) || ""} onChange={(e) => set("departmentId", e.target.value)} placeholder="Unchanged" options={departments.map((d) => ({ value: d.id, label: d.name }))} />}
          {showsLocation && <Select label="New location" value={(changes.locationId as string) || ""} onChange={(e) => set("locationId", e.target.value)} placeholder="Unchanged" options={locations.map((d) => ({ value: d.id, label: d.name }))} />}
          {showsManager && <Select label="New manager" value={(changes.managerId as string) || ""} onChange={(e) => set("managerId", e.target.value)} placeholder="Unchanged" options={employees.filter((e) => e.id !== employeeId).map((e) => ({ value: e.id, label: `${e.fullName} (${e.employeeCode})` }))} />}
          {type === "shift" && <Select label="New shift" value={(changes.shiftId as string) || ""} onChange={(e) => set("shiftId", e.target.value)} placeholder="Choose" options={shifts.map((s) => ({ value: s.id, label: s.name }))} />}
          {type === "employment_type" && <Select label="Employment type" value={(changes.employmentType as string) || ""} onChange={(e) => set("employmentType", e.target.value)} placeholder="Choose" options={["full_time", "part_time", "contract", "intern", "consultant", "temporary"].map((t) => ({ value: t, label: humanise(t) }))} />}
          {type === "work_mode" && <Select label="Work mode" value={(changes.workMode as string) || ""} onChange={(e) => set("workMode", e.target.value)} placeholder="Choose" options={["on_site", "remote", "hybrid"].map((t) => ({ value: t, label: humanise(t) }))} />}
          {type === "probation_extension" && <Input label="Probation now runs for (months)" type="number" min={1} max={24} value={(changes.probationMonths as number) || ""} onChange={(e) => set("probationMonths", Number(e.target.value))} />}
        </FieldGrid>
        {type === "confirmation" && <Callout tone="info">Sets the confirmation date to the effective date and, if enabled, generates the confirmation letter.</Callout>}
        {can("payroll.assign_salary") && ["promotion", "confirmation"].includes(type) && (
          <FieldGrid columns={2}>
            <Select label="Salary structure (optional revision)" value={structureId} onChange={(e) => setStructureId(e.target.value)} placeholder="No salary change" options={(structures || []).map((s) => ({ value: s.id, label: s.name }))} />
            <Input label="New annual CTC" type="number" min={0} value={ctcAnnual} onChange={(e) => setCtcAnnual(e.target.value)} disabled={!structureId} />
          </FieldGrid>
        )}
        <Textarea label="Reason (optional)" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        <Switch label="Generate the letter" hint="Promotion, transfer, confirmation or probation-extension letter from your templates, into the employee's documents." checked={generateLetter} onChange={setGenerateLetter} />
      </div>
    </Modal>
  );
}
