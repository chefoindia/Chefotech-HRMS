"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { Button, Callout, Input, Modal, useToast } from "@/components/ui";

/**
 * Change password. Used from the profile page, the security page, and the
 * forced-change flow when an organization expires passwords.
 */
export function ChangePasswordDialog({
  open,
  onClose,
  onDone,
  forced = false,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
  /** The organization's expiry rule requires a new password before continuing. */
  forced?: boolean;
}) {
  const toast = useToast();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);

  const change = useMutation({
    mutationFn: async () => {
      await api.post("/auth/change-password", { currentPassword: form.currentPassword, newPassword: form.newPassword });
    },
    onSuccess: () => {
      toast.success("Password changed", "You will be signed out of every device.");
      onDone();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Could not change your password.");
    },
  });

  return (
    <Modal
      open={open}
      onClose={forced ? () => undefined : onClose}
      title={forced ? "Choose a new password" : "Change your password"}
      size="sm"
      footer={
        <>
          {!forced && (
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
          )}
          <Button
            loading={change.isPending}
            disabled={!form.currentPassword || !form.newPassword || form.newPassword !== form.confirm}
            onClick={() => {
              setError(null);
              change.mutate();
            }}
          >
            Change password
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Callout tone="danger">{error}</Callout>}

        <Callout tone="info">
          {forced ? "Your organization requires a new password on a schedule, and yours is due. " : ""}
          Changing your password signs you out everywhere, including this device.
        </Callout>

        <Input
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={form.currentPassword}
          onChange={(event) => setForm({ ...form, currentPassword: event.target.value })}
        />
        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          value={form.newPassword}
          onChange={(event) => setForm({ ...form, newPassword: event.target.value })}
          hint="With an uppercase letter, a lowercase letter and a number. Your organization sets the minimum length."
        />
        <Input
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={form.confirm}
          onChange={(event) => setForm({ ...form, confirm: event.target.value })}
          error={form.confirm && form.newPassword !== form.confirm ? "These do not match" : undefined}
        />
      </div>
    </Modal>
  );
}
