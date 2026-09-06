"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useReferenceData } from "@/lib/hooks";
import { humanise, todayString } from "@/lib/format";
import { Button, Callout, FieldGrid, Input, Modal, Select, Textarea, useToast } from "@/components/ui";
import type { RequestType, RequestTypeInfo } from "@/lib/moduleTypes";
import { useEmployeeOptions } from "@/components/documents/EmployeePicker";

/**
 * "New request": the type decides the fields. Every type maps to a schema
 * on the server (request.types.js); this form mirrors those fields and lets
 * the server be the judge of what is valid.
 */
export function RequestForm({ onClose, onDone, employeeId, initialType }: { onClose: () => void; onDone: () => void; employeeId?: string; initialType?: RequestType }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [type, setType] = useState<RequestType | "">(initialType || "");
  const [payload, setPayload] = useState<Record<string, unknown>>({});
  const [reason, setReason] = useState("");

  const { data: types } = useQuery({
    queryKey: ["requests", "types"],
    queryFn: async () => (await api.get<RequestTypeInfo[]>("/requests/types")).data,
    staleTime: 10 * 60_000,
  });

  useEffect(() => {
    setPayload({});
  }, [type]);

  const submit = useMutation({
    mutationFn: async () => {
      const body = { type, payload, reason };
      if (employeeId) return (await api.post("/requests/on-behalf", { ...body, employeeId })).data;
      return (await api.post("/requests", body)).data;
    },
    onSuccess: () => {
      toast.success("Request sent", "You will be told as soon as it is decided.");
      queryClient.invalidateQueries({ queryKey: ["requests"] });
      onDone();
    },
    onError: (error) => toast.fromError(error, "Could not send that request."),
  });

  const info = types?.find((t) => t.key === type);
  const set = (key: string, value: unknown) => setPayload((p) => ({ ...p, [key]: value }));

  return (
    <Modal
      open
      onClose={onClose}
      title={employeeId ? "Raise a request on their behalf" : "New request"}
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={submit.isPending} disabled={!type} onClick={() => submit.mutate()}>
            Send request
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Select label="What do you need?" value={type} onChange={(e) => setType(e.target.value as RequestType)} placeholder="Choose a request type" options={(types || []).map((t) => ({ value: t.key, label: t.label }))} hint={info?.description} />
        {info && <p className="text-[12px] text-[var(--text-subtle)]">Decided by {info.approver === "manager" ? "your reporting manager" : "HR"}.</p>}

        {type === "wfh" && (
          <FieldGrid columns={2}>
            <Input label="From" type="date" value={(payload.fromDate as string) || ""} onChange={(e) => set("fromDate", e.target.value)} required />
            <Input label="To" type="date" value={(payload.toDate as string) || ""} onChange={(e) => set("toDate", e.target.value)} required />
          </FieldGrid>
        )}

        {type === "comp_off" && (
          <FieldGrid columns={2}>
            <Input label="Day you worked" type="date" max={todayString()} value={(payload.workedOn as string) || ""} onChange={(e) => set("workedOn", e.target.value)} required />
            <Select label="Days to credit" value={String(payload.days ?? 1)} onChange={(e) => set("days", Number(e.target.value))} options={[{ value: "0.5", label: "Half day" }, { value: "1", label: "One day" }, { value: "2", label: "Two days" }]} />
          </FieldGrid>
        )}

        {type === "encashment" && <EncashmentFields payload={payload} set={set} />}
        {type === "shift_swap" && <ShiftSwapFields payload={payload} set={set} />}
        {type === "letter" && <LetterFields payload={payload} set={set} />}
        {type === "profile_change" && <ProfileChangeFields payload={payload} set={set} />}

        {type === "advance" && (
          <FieldGrid columns={2}>
            <Input label="Amount" type="number" min={1} value={(payload.amount as number) ?? ""} onChange={(e) => set("amount", Number(e.target.value))} required />
            <Input label="Recover from salary of (optional)" type="month" value={(payload.recoverInPeriod as string) || ""} onChange={(e) => set("recoverInPeriod", e.target.value || undefined)} hint="Blank recovers it from the next payslip." />
          </FieldGrid>
        )}

        {type === "other" && <Input label="Subject" value={(payload.subject as string) || ""} onChange={(e) => set("subject", e.target.value)} required />}

        {type && <Textarea label={type === "other" ? "Details" : "Reason (optional)"} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </div>
    </Modal>
  );
}

function EncashmentFields({ payload, set }: { payload: Record<string, unknown>; set: (k: string, v: unknown) => void }) {
  const { data: balances } = useQuery({
    queryKey: ["me", "leave-balances"],
    queryFn: async () => (await api.get<Array<{ leaveType: { id: string; name: string }; hasBalance: boolean; available: number | null }>>("/leave/me/balances")).data,
  });
  const encashable = (balances || []).filter((b) => b.hasBalance && (b.available || 0) > 0);
  return (
    <div className="space-y-3">
      <FieldGrid columns={2}>
        <Select label="Leave type" value={(payload.leaveTypeId as string) || ""} onChange={(e) => set("leaveTypeId", e.target.value)} placeholder="Choose" options={encashable.map((b) => ({ value: b.leaveType.id, label: `${b.leaveType.name} (${b.available} available)` }))} />
        <Input label="Days to encash" type="number" min={0.5} step={0.5} value={(payload.days as number) ?? ""} onChange={(e) => set("days", Number(e.target.value))} />
      </FieldGrid>
      <Callout tone="info">The amount is worked out from your salary and paid with the next payslip once HR approves.</Callout>
    </div>
  );
}

function ShiftSwapFields({ payload, set }: { payload: Record<string, unknown>; set: (k: string, v: unknown) => void }) {
  const { shifts } = useReferenceData();
  const { employees } = useEmployeeOptions();
  return (
    <FieldGrid columns={2}>
      <Select label="Shift you want" value={(payload.shiftId as string) || ""} onChange={(e) => set("shiftId", e.target.value)} placeholder="Choose a shift" options={shifts.map((s) => ({ value: s.id, label: `${s.name} (${s.startTime}–${s.endTime})` }))} />
      <Select label="Swap with a colleague (optional)" value={(payload.swapWithEmployeeId as string) || ""} onChange={(e) => set("swapWithEmployeeId", e.target.value || undefined)} placeholder="Nobody — just change mine" options={employees.map((e) => ({ value: e.id, label: `${e.fullName} (${e.employeeCode})` }))} />
      <Input label="From" type="date" value={(payload.fromDate as string) || ""} onChange={(e) => set("fromDate", e.target.value)} required />
      <Input label="To" type="date" value={(payload.toDate as string) || ""} onChange={(e) => set("toDate", e.target.value)} required />
    </FieldGrid>
  );
}

function LetterFields({ payload, set }: { payload: Record<string, unknown>; set: (k: string, v: unknown) => void }) {
  const LETTERS = [
    { code: "BONAFIDE", label: "Bonafide certificate" },
    { code: "ADDRESS_PROOF", label: "Address proof letter" },
    { code: "SALARY_CERTIFICATE", label: "Salary certificate" },
    { code: "NOC", label: "No objection certificate" },
    { code: "EXPERIENCE", label: "Experience certificate" },
  ];
  return (
    <div className="space-y-3">
      <Select label="Letter" value={(payload.templateCode as string) || ""} onChange={(e) => set("templateCode", e.target.value)} placeholder="Choose" options={LETTERS.map((l) => ({ value: l.code, label: l.label }))} />
      <Input label="Purpose (optional)" placeholder="e.g. visa application, bank loan" value={(payload.purpose as string) || ""} onChange={(e) => set("purpose", e.target.value)} />
      <p className="text-[12px] text-[var(--text-subtle)]">HR approves and the letter is generated into your documents automatically.</p>
    </div>
  );
}

function ProfileChangeFields({ payload, set }: { payload: Record<string, unknown>; set: (k: string, v: unknown) => void }) {
  const section = (payload.section as string) || "";
  const changes = (payload.changes as Record<string, string>) || {};
  const setChange = (key: string, value: string) => set("changes", { ...changes, [key]: value });
  const FIELDS: Record<string, Array<{ key: string; label: string }>> = {
    bank: [
      { key: "bankName", label: "Bank" },
      { key: "accountNumber", label: "Account number" },
      { key: "ifscCode", label: "IFSC" },
      { key: "accountHolderName", label: "Account holder name" },
    ],
    personal: [
      { key: "phone", label: "Phone" },
      { key: "personalEmail", label: "Personal email" },
      { key: "currentAddress.line1", label: "Address line 1" },
      { key: "currentAddress.city", label: "City" },
      { key: "currentAddress.postalCode", label: "Postal code" },
    ],
    statutory: [
      { key: "uan", label: "UAN" },
      { key: "pfNumber", label: "PF number" },
      { key: "esiNumber", label: "ESI number" },
      { key: "taxId", label: "PAN" },
    ],
  };
  return (
    <div className="space-y-3">
      <Select label="Which details" value={section} onChange={(e) => { set("section", e.target.value); set("changes", {}); }} placeholder="Choose" options={Object.keys(FIELDS).map((k) => ({ value: k, label: humanise(k) }))} />
      {section && (
        <FieldGrid columns={2}>
          {FIELDS[section].map((f) => (
            <Input key={f.key} label={f.label} value={changes[f.key] || ""} onChange={(e) => setChange(f.key, e.target.value)} placeholder="Leave blank to keep" />
          ))}
        </FieldGrid>
      )}
      <p className="text-[12px] text-[var(--text-subtle)]">Only the fields you fill in are changed, after HR approves.</p>
    </div>
  );
}
