"use client";

import { useState } from "react";
import { Button, Input, Modal, Textarea } from "@/components/ui";

/**
 * Approve or reject with an optional note. Shared by requests, expense
 * claims and loans so every approval screen reads the same way.
 */
export function DecisionDialog({
  title,
  decision,
  loading,
  onClose,
  onConfirm,
  amountLabel,
  amountDefault,
  children,
}: {
  title: string;
  decision: "approve" | "reject";
  loading?: boolean;
  onClose: () => void;
  onConfirm: (comment: string, amount?: number | null) => void;
  /** When set, an approver may trim the amount (expense claims). */
  amountLabel?: string;
  amountDefault?: number | null;
  children?: React.ReactNode;
}) {
  const [comment, setComment] = useState("");
  const [amount, setAmount] = useState(amountDefault !== null && amountDefault !== undefined ? String(amountDefault) : "");
  const approving = decision === "approve";

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={approving ? "primary" : "danger"} loading={loading} disabled={!approving && !comment.trim()} onClick={() => onConfirm(comment.trim(), amountLabel ? (amount === "" ? null : Number(amount)) : undefined)}>
            {approving ? "Approve" : "Reject"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {children}
        {approving && amountLabel && <Input label={amountLabel} type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} hint="Leave as is to approve the full amount." />}
        <Textarea label={approving ? "Note (optional)" : "Reason"} rows={3} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={approving ? "Anything the employee should know" : "Tell them why, so they can fix it"} required={!approving} />
      </div>
    </Modal>
  );
}
