"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Paperclip, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatMoney, humanise, todayString } from "@/lib/format";
import { Button, Callout, FieldGrid, Input, Modal, Select, Textarea, useToast } from "@/components/ui";
import type { ExpenseClaim, ExpenseLine, ExpensePolicy } from "@/lib/moduleTypes";

/** Create or edit an expense claim: lines with receipts, then submit. */
export function ExpenseForm({ claim, onClose, onDone }: { claim?: ExpenseClaim | null; onClose: () => void; onDone: () => void }) {
  const { session } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const currency = session?.organization?.currency || "INR";
  const locale = session?.organization?.locale || "en-IN";

  const [title, setTitle] = useState(claim?.title || "");
  const [purpose, setPurpose] = useState(claim?.purpose || "");
  const [advanceAmount, setAdvanceAmount] = useState(claim?.advanceAmount || 0);
  const [lines, setLines] = useState<ExpenseLine[]>(claim?.lines?.length ? claim.lines : [{ date: todayString(), category: "", description: "", amount: 0, receiptFileId: null }]);

  const { data: policy } = useQuery({
    queryKey: ["expenses", "policy"],
    queryFn: async () => (await api.get<ExpensePolicy>("/expenses/policy")).data,
    staleTime: 10 * 60_000,
  });

  const save = useMutation({
    mutationFn: async (submit: boolean) => {
      const body = { title, purpose, advanceAmount, lines: lines.map((l) => ({ ...l, id: undefined, amount: Number(l.amount) || 0, distanceKm: l.distanceKm || null })) };
      if (claim) {
        await api.patch(`/expenses/${claim.id}`, body);
        if (submit) await api.post(`/expenses/${claim.id}/submit`);
        return;
      }
      await api.post("/expenses", { ...body, submit });
    },
    onSuccess: (_, submit) => {
      toast.success(submit ? "Claim submitted" : "Draft saved", submit ? "Your approver has been notified." : undefined);
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      onDone();
    },
    onError: (error) => toast.fromError(error, "Could not save the claim."),
  });

  const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const setLine = (i: number, patch: Partial<ExpenseLine>) => setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const categories = policy?.categories || [];

  return (
    <Modal
      open
      onClose={onClose}
      title={claim ? `Edit claim #${claim.number}` : "New expense claim"}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="outline" loading={save.isPending && save.variables === false} disabled={!title.trim()} onClick={() => save.mutate(false)}>
            Save draft
          </Button>
          <Button loading={save.isPending && save.variables === true} disabled={!title.trim() || !lines.length || lines.some((l) => !l.category)} onClick={() => save.mutate(true)}>
            Submit for approval
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FieldGrid columns={2}>
          <Input label="Title" placeholder="e.g. Client visit, Pune, 12 Mar" value={title} onChange={(e) => setTitle(e.target.value)} required />
          <Input label="Advance already received (optional)" type="number" min={0} value={advanceAmount || ""} onChange={(e) => setAdvanceAmount(Number(e.target.value) || 0)} />
        </FieldGrid>
        <Textarea label="Purpose (optional)" rows={2} value={purpose} onChange={(e) => setPurpose(e.target.value)} />

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-medium text-[var(--text)]">Expense lines</p>
            <p className="text-[13px] text-[var(--text-muted)]">
              Total <strong className="text-[var(--text)]">{formatMoney(total, { currency, locale })}</strong>
            </p>
          </div>
          {lines.map((line, i) => (
            <div key={i} className="rounded-md border p-3">
              <div className="grid gap-2 sm:grid-cols-[8rem_1fr_7rem_auto]">
                <Input type="date" value={line.date} onChange={(e) => setLine(i, { date: e.target.value })} aria-label="Date" />
                <select value={line.category} onChange={(e) => setLine(i, { category: e.target.value })} className="input-base" aria-label="Category">
                  <option value="">Category…</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {humanise(c)}
                    </option>
                  ))}
                </select>
                <Input type="number" min={0} step="0.01" value={line.amount || ""} placeholder="Amount" onChange={(e) => setLine(i, { amount: Number(e.target.value) })} aria-label="Amount" />
                <Button variant="ghost" size="icon" aria-label="Remove line" onClick={() => setLines(lines.filter((_, idx) => idx !== i))}>
                  <Trash2 className="h-3.5 w-3.5 text-[var(--danger)]" />
                </Button>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_9rem_auto]">
                <Input placeholder="Description" value={line.description || ""} onChange={(e) => setLine(i, { description: e.target.value })} aria-label="Description" />
                {policy?.mileageRate ? <Input type="number" min={0} placeholder="Distance km" value={line.distanceKm || ""} onChange={(e) => setLine(i, { distanceKm: Number(e.target.value) || null })} aria-label="Distance" /> : <span />}
                <ReceiptButton fileId={line.receiptFileId} onUploaded={(id) => setLine(i, { receiptFileId: id })} />
              </div>
              {policy?.receiptAbove && line.amount > policy.receiptAbove && !line.receiptFileId ? <p className="mt-1 text-[12px] text-[var(--warning)]">A receipt is required above {formatMoney(policy.receiptAbove, { currency, locale })}.</p> : null}
            </div>
          ))}
          <Button variant="outline" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setLines([...lines, { date: todayString(), category: "", description: "", amount: 0, receiptFileId: null }])}>
            Add line
          </Button>
        </div>

        {policy && (policy.maxClaim || policy.receiptAbove) ? (
          <Callout tone="info">
            {policy.maxClaim ? `A single claim may not exceed ${formatMoney(policy.maxClaim, { currency, locale })}. ` : ""}
            {policy.receiptAbove ? `Receipts are required for lines above ${formatMoney(policy.receiptAbove, { currency, locale })}.` : ""}
          </Callout>
        ) : null}
      </div>
    </Modal>
  );
}

function ReceiptButton({ fileId, onUploaded }: { fileId: string | null; onUploaded: (id: string) => void }) {
  const toast = useToast();
  const { session } = useSession();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (file: File) => {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("category", "attachment");
      form.append("ownerType", "ExpenseClaim");
      if (session?.employeeId) form.append("ownerId", session.employeeId);
      const { data } = await api.upload<{ id: string }>("/files", form);
      onUploaded(data.id);
      toast.success("Receipt attached");
    } catch (error) {
      toast.fromError(error, "Could not upload the receipt.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <input ref={input} type="file" className="hidden" accept="image/*,application/pdf" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
      <Button variant={fileId ? "ghost" : "outline"} size="sm" loading={busy} icon={<Paperclip className="h-3.5 w-3.5" />} onClick={() => input.current?.click()}>
        {fileId ? "Receipt attached" : "Receipt"}
      </Button>
    </>
  );
}
