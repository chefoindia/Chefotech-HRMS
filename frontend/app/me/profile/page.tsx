"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Lock, Save } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatDate, humanise } from "@/lib/format";
import { refLabel, setPath } from "@/lib/utils";
import {
  Avatar,
  Button,
  Callout,
  Card,
  CardHeader,
  DetailGrid,
  DetailItem,
  FieldGrid,
  Input,
  Modal,
  PageHeader,
  PageLoader,
  useToast,
} from "@/components/ui";
import type { Employee } from "@/lib/types";

/**
 * My profile.
 *
 * Which fields an employee may edit is a tenant setting, not a hard-coded
 * list — the API rejects anything outside it and reports what it rejected, so
 * this page stays correct even when an organization narrows the list.
 */
export default function MyProfilePage() {
  const { session, signOut } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const locale = session?.organization?.locale || "en-IN";

  const [form, setForm] = useState<Record<string, unknown>>({});
  const [dirty, setDirty] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  const { data: employee, isLoading } = useQuery({
    queryKey: ["me", "profile"],
    queryFn: async () => {
      const { data } = await api.get<Employee>("/employees/me");
      return data;
    },
  });

  useEffect(() => {
    if (employee) setForm({ personal: { ...employee.personal } });
  }, [employee]);

  const save = useMutation({
    mutationFn: async () => {
      const { data } = await api.patch<{ applied: string[]; rejected: string[] }>(
        "/employees/me",
        form
      );
      return data;
    },
    onSuccess: (result) => {
      if (result.rejected.length) {
        toast.warning(
          "Some changes were not applied",
          `Your organization does not allow you to edit: ${result.rejected.join(", ")}.`
        );
      } else {
        toast.success("Profile updated");
      }
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (error) => toast.fromError(error, "Could not save your profile."),
  });

  const uploadAvatar = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      await api.upload(`/employees/${employee!.id}/avatar`, formData);
    },
    onSuccess: () => {
      toast.success("Photo updated");
      queryClient.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (error) => toast.fromError(error, "Could not upload that photo."),
  });

  const set = (path: string, value: unknown) => {
    setForm((current) => setPath(current, path, value));
    setDirty(true);
  };

  if (isLoading) return <PageLoader label="Loading your profile" />;
  if (!employee) return null;

  const personal = (form.personal || {}) as Record<string, string>;

  return (
    <>
      <PageHeader
        title="My profile"
        description="Keep your contact details up to date. Employment details are managed by HR."
        actions={
          <Button variant="outline" icon={<Lock className="h-4 w-4" />} onClick={() => setChangingPassword(true)}>
            Change password
          </Button>
        }
      />

      <Card className="mb-5">
        <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          <div className="relative">
            <Avatar src={employee.avatarUrl} name={employee.fullName} size="xl" />
            <label className="absolute -bottom-1 -right-1 grid h-8 w-8 cursor-pointer place-items-center rounded-full border-2 border-[var(--surface)] bg-brand-600 text-white hover:bg-brand-700">
              <Camera className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only">Change photo</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) uploadAvatar.mutate(file);
                  event.target.value = "";
                }}
              />
            </label>
          </div>

          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-[var(--text)]">{employee.fullName}</h2>
            <p className="text-[13.5px] text-[var(--text-muted)]">
              {refLabel(employee.employment.designationId, "")}
              {employee.employment.departmentId && ` · ${refLabel(employee.employment.departmentId)}`}
            </p>
            <p className="mt-1 font-mono text-[12px] text-[var(--text-subtle)]">
              {employee.employeeCode}
            </p>
          </div>
        </div>
      </Card>

      <Card className="mb-5">
        <CardHeader
          title="Contact details"
          description="These are the fields you can change yourself."
          action={
            <Button
              size="sm"
              loading={save.isPending}
              disabled={!dirty}
              onClick={() => save.mutate()}
              icon={<Save className="h-3.5 w-3.5" />}
            >
              Save
            </Button>
          }
        />

        <div className="mt-5 space-y-4">
          <FieldGrid columns={2}>
            <Input
              label="Phone"
              value={personal.phone || ""}
              onChange={(event) => set("personal.phone", event.target.value)}
            />
            <Input
              label="Alternate phone"
              value={personal.alternatePhone || ""}
              onChange={(event) => set("personal.alternatePhone", event.target.value)}
            />
            <Input
              label="Personal email"
              type="email"
              value={personal.personalEmail || ""}
              onChange={(event) => set("personal.personalEmail", event.target.value)}
            />
          </FieldGrid>

          <FieldGrid columns={2}>
            <Input
              label="Current address"
              value={(personal.currentAddress as unknown as Record<string, string>)?.line1 || ""}
              onChange={(event) => set("personal.currentAddress.line1", event.target.value)}
            />
            <Input
              label="City"
              value={(personal.currentAddress as unknown as Record<string, string>)?.city || ""}
              onChange={(event) => set("personal.currentAddress.city", event.target.value)}
            />
          </FieldGrid>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Employment"
          description="Managed by HR. If something here is wrong, ask them to correct it."
        />
        <DetailGrid className="mt-4">
          <DetailItem label="Employee code" value={employee.employeeCode} />
          <DetailItem label="Department" value={refLabel(employee.employment.departmentId)} />
          <DetailItem label="Designation" value={refLabel(employee.employment.designationId)} />
          <DetailItem label="Location" value={refLabel(employee.employment.locationId)} />
          <DetailItem label="Manager" value={refLabel(employee.employment.managerId)} />
          <DetailItem
            label="Joining date"
            value={formatDate(employee.employment.joiningDate, { locale })}
          />
          <DetailItem
            label="Employment type"
            value={humanise(employee.employment.employmentType)}
          />
          <DetailItem label="Status" value={humanise(employee.status)} />
        </DetailGrid>
      </Card>

      <ChangePasswordDialog
        open={changingPassword}
        onClose={() => setChangingPassword(false)}
        onDone={signOut}
      />
    </>
  );
}

function ChangePasswordDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);

  const change = useMutation({
    mutationFn: async () => {
      await api.post("/auth/change-password", {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
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
      onClose={onClose}
      title="Change your password"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={change.isPending}
            disabled={
              !form.currentPassword || !form.newPassword || form.newPassword !== form.confirm
            }
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
          hint="At least 10 characters, with an uppercase letter, a lowercase letter and a number."
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
