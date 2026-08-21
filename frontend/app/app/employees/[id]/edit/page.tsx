"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Save } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useReferenceData, toOptions } from "@/lib/hooks";
import { refId, setPath } from "@/lib/utils";
import {
  Button,
  Callout,
  Card,
  FieldGrid,
  FieldSet,
  Input,
  NoAccessState,
  PageHeader,
  PageLoader,
  Select,
  useToast,
} from "@/components/ui";
import type { Employee } from "@/lib/types";

export default function EditEmployeePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { can } = useSession();
  const reference = useReferenceData();

  const [form, setForm] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: employee, isLoading } = useQuery({
    queryKey: ["employee", params.id],
    queryFn: async () => {
      const { data } = await api.get<Employee>(`/employees/${params.id}`);
      return data;
    },
  });

  useEffect(() => {
    if (!employee) return;
    setForm({
      biometricId: employee.biometricId,
      personal: { ...employee.personal },
      employment: {
        ...employee.employment,
        departmentId: refId(employee.employment.departmentId),
        designationId: refId(employee.employment.designationId),
        locationId: refId(employee.employment.locationId),
        managerId: refId(employee.employment.managerId),
        joiningDate: (employee.employment.joiningDate || "").slice(0, 10) || null,
        confirmationDate: (employee.employment.confirmationDate || "").slice(0, 10) || null,
      },
      bank: { ...(employee.bank || {}) },
      statutory: { ...(employee.statutory || {}) },
    });
  }, [employee]);

  const { data: colleagues } = useQuery({
    queryKey: ["employees", "picker"],
    queryFn: async () => {
      const { data } = await api.get<Array<{ id: string; fullName: string; employeeCode: string }>>(
        "/employees",
        { query: { limit: 200 } }
      );
      return data;
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      await api.patch(`/employees/${params.id}`, form);
    },
    onSuccess: () => {
      toast.success("Employee updated");
      router.push(`/app/employees/${params.id}`);
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        const fieldErrors: Record<string, string> = {};
        for (const [key, message] of Object.entries(error.fieldErrors)) {
          fieldErrors[key.replace(/^body\./, "")] = message;
        }
        setErrors(fieldErrors);
      }
      toast.fromError(error, "Could not save those changes.");
    },
  });

  const set = (path: string, value: unknown) => {
    setForm((current) => setPath(current, path, value));
    setErrors((current) => ({ ...current, [path]: "" }));
  };

  if (!can("employee.update")) return <NoAccessState what="editing employees" />;
  if (isLoading || !employee) return <PageLoader label="Loading employee" />;

  const personal = (form.personal || {}) as Record<string, string>;
  const employment = (form.employment || {}) as Record<string, string>;
  const bank = (form.bank || {}) as Record<string, string>;
  const canSeeSensitive = can("employee.view_sensitive");

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title={`Edit ${employee.fullName}`}
        description="Employment status is changed from the profile page, so the reason is always recorded."
        breadcrumb={
          <Link
            href={`/app/employees/${params.id}`}
            className="mb-2 inline-flex items-center gap-1.5 text-[13px] text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Back to profile
          </Link>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button loading={save.isPending} onClick={() => save.mutate()} icon={<Save className="h-4 w-4" />}>
              Save changes
            </Button>
          </>
        }
      />

      <div className="space-y-5">
        <Card>
          <FieldSet title="Personal">
            <FieldGrid columns={3}>
              <Input
                label="First name"
                required
                value={personal.firstName || ""}
                onChange={(event) => set("personal.firstName", event.target.value)}
                error={errors["personal.firstName"]}
              />
              <Input
                label="Middle name"
                value={personal.middleName || ""}
                onChange={(event) => set("personal.middleName", event.target.value)}
              />
              <Input
                label="Last name"
                value={personal.lastName || ""}
                onChange={(event) => set("personal.lastName", event.target.value)}
              />
            </FieldGrid>

            <FieldGrid columns={3}>
              <Input
                label="Work email"
                type="email"
                value={personal.workEmail || ""}
                onChange={(event) => set("personal.workEmail", event.target.value)}
                error={errors["personal.workEmail"]}
              />
              <Input
                label="Phone"
                value={personal.phone || ""}
                onChange={(event) => set("personal.phone", event.target.value)}
              />
              <Input
                label="Date of birth"
                type="date"
                value={(personal.dateOfBirth || "").slice(0, 10)}
                onChange={(event) => set("personal.dateOfBirth", event.target.value)}
              />
            </FieldGrid>
          </FieldSet>
        </Card>

        <Card>
          <FieldSet title="Employment">
            <FieldGrid columns={3}>
              <Select
                label="Department"
                value={employment.departmentId || ""}
                onChange={(event) => set("employment.departmentId", event.target.value || null)}
                options={toOptions(reference.departments)}
                placeholder="Not assigned"
              />
              <Select
                label="Designation"
                value={employment.designationId || ""}
                onChange={(event) => set("employment.designationId", event.target.value || null)}
                options={toOptions(reference.designations)}
                placeholder="Not assigned"
              />
              <Select
                label="Location"
                value={employment.locationId || ""}
                onChange={(event) => set("employment.locationId", event.target.value || null)}
                options={toOptions(reference.locations)}
                placeholder="Not assigned"
              />
            </FieldGrid>

            <FieldGrid columns={3}>
              <Select
                label="Reports to"
                value={employment.managerId || ""}
                onChange={(event) => set("employment.managerId", event.target.value || null)}
                options={(colleagues || [])
                  .filter((colleague) => colleague.id !== params.id)
                  .map((colleague) => ({
                    value: colleague.id,
                    label: `${colleague.fullName} (${colleague.employeeCode})`,
                  }))}
                placeholder="Nobody"
                hint="A reporting line that loops back is rejected."
                error={errors["employment.managerId"]}
              />
              <Select
                label="Shift"
                value={employment.shiftId || ""}
                onChange={(event) => set("employment.shiftId", event.target.value || null)}
                options={reference.shifts.map((shift) => ({
                  value: shift.id,
                  label: `${shift.name} (${shift.startTime}–${shift.endTime})`,
                }))}
                placeholder="Organization default"
              />
              <Input
                label="Biometric / device ID"
                value={(form.biometricId as string) || ""}
                onChange={(event) => set("biometricId", event.target.value)}
                hint="Must match their enrolment number on the device."
                error={errors.biometricId}
              />
            </FieldGrid>

            <FieldGrid columns={3}>
              <Input
                label="Joining date"
                type="date"
                value={employment.joiningDate || ""}
                onChange={(event) => set("employment.joiningDate", event.target.value)}
              />
              <Input
                label="Confirmation date"
                type="date"
                value={employment.confirmationDate || ""}
                onChange={(event) => set("employment.confirmationDate", event.target.value)}
              />
              <Select
                label="Employment type"
                value={employment.employmentType || "full_time"}
                onChange={(event) => set("employment.employmentType", event.target.value)}
                options={[
                  "full_time",
                  "part_time",
                  "contract",
                  "intern",
                  "consultant",
                  "temporary",
                ].map((value) => ({ value, label: value.replace(/_/g, " ") }))}
              />
            </FieldGrid>
          </FieldSet>
        </Card>

        {canSeeSensitive ? (
          <Card>
            <FieldSet title="Bank details" description="Used for salary payment.">
              <FieldGrid columns={2}>
                <Input
                  label="Account holder"
                  value={bank.accountHolderName || ""}
                  onChange={(event) => set("bank.accountHolderName", event.target.value)}
                />
                <Input
                  label="Account number"
                  value={bank.accountNumber || ""}
                  onChange={(event) => set("bank.accountNumber", event.target.value)}
                />
                <Input
                  label="Bank name"
                  value={bank.bankName || ""}
                  onChange={(event) => set("bank.bankName", event.target.value)}
                />
                <Input
                  label="IFSC / sort code"
                  value={bank.ifscCode || ""}
                  onChange={(event) => set("bank.ifscCode", event.target.value)}
                />
              </FieldGrid>
            </FieldSet>
          </Card>
        ) : (
          <Callout tone="info">
            Bank, statutory and identity details need the <strong>view sensitive data</strong>{" "}
            permission to edit.
          </Callout>
        )}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button loading={save.isPending} onClick={() => save.mutate()} icon={<Save className="h-4 w-4" />}>
          Save changes
        </Button>
      </div>
    </div>
  );
}
