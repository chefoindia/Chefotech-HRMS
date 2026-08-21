"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Save } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useReferenceData, toOptions } from "@/lib/hooks";
import { setPath } from "@/lib/utils";
import {
  Button,
  Callout,
  Card,
  Checkbox,
  FieldGrid,
  FieldSet,
  Input,
  PageHeader,
  Select,
  useToast,
} from "@/components/ui";
import type { Employee } from "@/lib/types";

interface CustomField {
  id: string;
  key: string;
  label: string;
  type: string;
  section: string;
  required: boolean;
  options: Array<{ value: string; label: string }>;
  helpText: string;
  isActive: boolean;
}

/**
 * Add an employee.
 *
 * Deliberately short: a name and a joining date are all that is required.
 * Everything else can be filled in later from the profile, because the person
 * entering this is often doing it while the new joiner stands in front of them.
 */
export default function NewEmployeePage() {
  const router = useRouter();
  const toast = useToast();
  const reference = useReferenceData();

  const [form, setForm] = useState<Record<string, unknown>>({
    personal: { firstName: "", lastName: "", gender: "undisclosed" },
    employment: { employmentType: "full_time", workMode: "on_site" },
    customFields: {},
    sendInvite: false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: customFields } = useQuery({
    queryKey: ["employees", "custom-fields"],
    queryFn: async () => {
      const { data } = await api.get<CustomField[]>("/employees/custom-fields", {
        query: { isActive: "true" },
      });
      return data;
    },
    staleTime: 5 * 60_000,
  });

  const set = (path: string, value: unknown) => {
    setForm((current) => setPath(current, path, value));
    setErrors((current) => ({ ...current, [path]: "" }));
  };

  const create = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<Employee>("/employees", form);
      return data;
    },
    onSuccess: (employee) => {
      toast.success(
        `${employee.fullName} added`,
        `Employee code ${employee.employeeCode}${form.sendInvite ? " · invitation sent" : ""}`
      );
      router.push(`/app/employees/${employee.id}`);
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        const fieldErrors: Record<string, string> = {};
        for (const [key, message] of Object.entries(error.fieldErrors)) {
          fieldErrors[key.replace(/^body\./, "")] = message;
        }
        setErrors(fieldErrors);
      }
      toast.fromError(error, "Could not add this employee.");
    },
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  const personal = (form.personal || {}) as Record<string, string>;
  const employment = (form.employment || {}) as Record<string, string>;
  const custom = (form.customFields || {}) as Record<string, unknown>;

  return (
    <form onSubmit={submit} className="mx-auto max-w-4xl">
      <PageHeader
        title="Add an employee"
        description="Only a name and a joining date are required. You can complete the rest later."
        breadcrumb={
          <Link
            href="/app/employees"
            className="mb-2 inline-flex items-center gap-1.5 text-[13px] text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            Employees
          </Link>
        }
        actions={
          <>
            <Button variant="outline" type="button" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending} icon={<Save className="h-4 w-4" />} data-tour="employee-save">
              Save employee
            </Button>
          </>
        }
      />

      {create.error instanceof ApiError && !Object.keys(errors).length && (
        <Callout tone="danger" className="mb-4">
          {create.error.message}
        </Callout>
      )}

      <div className="space-y-5">
        <Card>
          <FieldSet title="Personal details" description="How this person appears across the product.">
            <FieldGrid columns={3}>
              <Input
                label="First name"
                required
                autoFocus
                value={personal.firstName || ""}
                onChange={(event) => set("personal.firstName", event.target.value)}
                error={errors["personal.firstName"]}
                data-tour="employee-first-name"
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
                data-tour="employee-last-name"
              />
            </FieldGrid>

            <FieldGrid columns={3}>
              <Select
                label="Gender"
                value={personal.gender || "undisclosed"}
                onChange={(event) => set("personal.gender", event.target.value)}
                options={[
                  { value: "male", label: "Male" },
                  { value: "female", label: "Female" },
                  { value: "other", label: "Other" },
                  { value: "undisclosed", label: "Prefer not to say" },
                ]}
                hint="Some leave types depend on this."
              />
              <Input
                label="Date of birth"
                type="date"
                value={(personal.dateOfBirth || "").slice(0, 10)}
                onChange={(event) => set("personal.dateOfBirth", event.target.value)}
                error={errors["personal.dateOfBirth"]}
              />
              <Input
                label="Blood group"
                value={personal.bloodGroup || ""}
                onChange={(event) => set("personal.bloodGroup", event.target.value)}
                placeholder="O+"
              />
            </FieldGrid>

            <FieldGrid columns={3}>
              <Input
                label="Work email"
                type="email"
                value={personal.workEmail || ""}
                onChange={(event) => set("personal.workEmail", event.target.value)}
                hint="Needed to invite them to the portal."
                error={errors["personal.workEmail"]}
                data-tour="employee-work-email"
              />
              <Input
                label="Personal email"
                type="email"
                value={personal.personalEmail || ""}
                onChange={(event) => set("personal.personalEmail", event.target.value)}
              />
              <Input
                label="Phone"
                value={personal.phone || ""}
                onChange={(event) => set("personal.phone", event.target.value)}
                placeholder="+91 98765 43210"
              />
            </FieldGrid>
          </FieldSet>
        </Card>

        <Card>
          <FieldSet title="Employment" description="Where this person sits and when they start.">
            <FieldGrid columns={3}>
              <Select
                label="Department"
                value={employment.departmentId || ""}
                onChange={(event) => set("employment.departmentId", event.target.value)}
                options={toOptions(reference.departments)}
                placeholder="Not assigned"
                data-tour="employee-department"
              />
              <Select
                label="Designation"
                value={employment.designationId || ""}
                onChange={(event) => set("employment.designationId", event.target.value)}
                options={toOptions(reference.designations)}
                placeholder="Not assigned"
                data-tour="employee-designation"
              />
              <Select
                label="Work location"
                value={employment.locationId || ""}
                onChange={(event) => set("employment.locationId", event.target.value)}
                options={toOptions(reference.locations)}
                placeholder="Not assigned"
              />
            </FieldGrid>

            <FieldGrid columns={3}>
              <Input
                label="Joining date"
                type="date"
                required
                value={(employment.joiningDate || "").slice(0, 10)}
                onChange={(event) => set("employment.joiningDate", event.target.value)}
                hint="Attendance and leave start from this date."
                error={errors["employment.joiningDate"]}
                data-tour="employee-joining-date"
              />
              <Select
                label="Employment type"
                value={employment.employmentType || "full_time"}
                onChange={(event) => set("employment.employmentType", event.target.value)}
                options={[
                  { value: "full_time", label: "Full time" },
                  { value: "part_time", label: "Part time" },
                  { value: "contract", label: "Contract" },
                  { value: "intern", label: "Intern" },
                  { value: "consultant", label: "Consultant" },
                  { value: "temporary", label: "Temporary" },
                ]}
              />
              <Select
                label="Shift"
                value={employment.shiftId || ""}
                onChange={(event) => set("employment.shiftId", event.target.value)}
                options={reference.shifts.map((shift) => ({
                  value: shift.id,
                  label: `${shift.name} (${shift.startTime}–${shift.endTime})`,
                }))}
                placeholder="Organization default"
              />
            </FieldGrid>

            <FieldGrid columns={2}>
              <Input
                label="Employee code"
                value={(form.employeeCode as string) || ""}
                onChange={(event) => set("employeeCode", event.target.value)}
                placeholder="Generated automatically"
                hint="Leave blank to use your numbering settings."
                error={errors.employeeCode}
              />
              <Input
                label="Biometric / device ID"
                value={(form.biometricId as string) || ""}
                onChange={(event) => set("biometricId", event.target.value)}
                hint="Must match their enrolment number on the attendance device."
                error={errors.biometricId}
              />
            </FieldGrid>
          </FieldSet>
        </Card>

        {customFields && customFields.length > 0 && (
          <Card>
            <FieldSet
              title="Additional details"
              description="Fields your organization added."
            >
              <FieldGrid columns={3}>
                {customFields.map((field) => {
                  const value = (custom[field.key] ?? "") as string;
                  const error = errors[`customFields.${field.key}`];

                  if (field.type === "dropdown") {
                    return (
                      <Select
                        key={field.id}
                        label={field.label}
                        required={field.required}
                        hint={field.helpText}
                        error={error}
                        value={value}
                        onChange={(event) => set(`customFields.${field.key}`, event.target.value)}
                        options={field.options}
                        placeholder="Choose…"
                      />
                    );
                  }

                  if (field.type === "boolean") {
                    return (
                      <div key={field.id} className="flex items-end pb-2">
                        <Checkbox
                          label={field.label}
                          hint={field.helpText}
                          checked={Boolean(custom[field.key])}
                          onChange={(event) => set(`customFields.${field.key}`, event.target.checked)}
                        />
                      </div>
                    );
                  }

                  return (
                    <Input
                      key={field.id}
                      label={field.label}
                      required={field.required}
                      hint={field.helpText}
                      error={error}
                      type={
                        field.type === "number" || field.type === "currency"
                          ? "number"
                          : field.type === "date"
                            ? "date"
                            : field.type === "email"
                              ? "email"
                              : "text"
                      }
                      value={value}
                      onChange={(event) => set(`customFields.${field.key}`, event.target.value)}
                    />
                  );
                })}
              </FieldGrid>
            </FieldSet>
          </Card>
        )}

        <Card>
          <Checkbox
            label="Invite them to the employee portal"
            hint="Sends an email so they can set a password, view their attendance and apply for leave."
            checked={Boolean(form.sendInvite)}
            onChange={(event) => set("sendInvite", event.target.checked)}
            disabled={!personal.workEmail}
          />
          {!personal.workEmail && (
            <p className="mt-2 text-[12.5px] text-[var(--text-subtle)]">
              Add a work email address above to enable this.
            </p>
          )}
        </Card>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" type="button" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button type="submit" loading={create.isPending} icon={<Save className="h-4 w-4" />}>
          Save employee
        </Button>
      </div>
    </form>
  );
}
