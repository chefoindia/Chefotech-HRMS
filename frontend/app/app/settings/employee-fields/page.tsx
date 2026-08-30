"use client";

import { SlidersHorizontal } from "lucide-react";
import { useSession } from "@/lib/session";
import { humanise } from "@/lib/format";
import { Badge, Callout, NoAccessState } from "@/components/ui";
import { MasterDataPage } from "@/components/data/MasterDataPage";

interface CustomField {
  id: string;
  key: string;
  label: string;
  type: string;
  section: string;
  required: boolean;
  unique: boolean;
  isSensitive: boolean;
  employeeEditable: boolean;
  isActive: boolean;
  order: number;
}

/**
 * Custom employee fields.
 *
 * The definition lives in its own collection and the value lives on the
 * employee as a map entry, so "we need a Uniform Size field" is a data change
 * rather than a schema migration — and one organization's fields are invisible
 * to every other one.
 */
export default function EmployeeFieldsPage() {
  const { can } = useSession();

  if (!can("employee.view")) return <NoAccessState what="employee fields" />;

  return (
    <>
      <Callout tone="info" className="mb-5">
        A field&apos;s <strong>key</strong> is fixed once created — it is the key under which the
        value is stored on thousands of employee records, so renaming it would orphan every value.
        Fields are deactivated rather than deleted, which keeps existing data intact.
      </Callout>

      <MasterDataPage<CustomField>
        title="Employee fields"
        description="Add fields your organization needs without waiting for a release. They appear on the employee form, in the import template, and in reports."
        resource="/employees/custom-fields"
        queryKey="custom-fields"
        entityName="Field"
        aiEntity="employee_field"
        can={can}
        permissions={{ view: "employee.view", manage: "employee.manage_custom_fields" }}
        emptyIcon={<SlidersHorizontal className="h-6 w-6" />}
        emptyDescription="Blood group, uniform size, an internal reference — whatever your HR team actually tracks."
        columns={[
          {
            key: "label",
            header: "Field",
            render: (row) => (
              <div className="min-w-0">
                <p className="truncate text-[13.5px] font-medium text-[var(--text)]">{row.label}</p>
                <p className="font-mono text-[12px] text-[var(--text-muted)]">{row.key}</p>
              </div>
            ),
          },
          { key: "type", header: "Type", render: (row) => humanise(row.type) },
          { key: "section", header: "Section", hideBelow: "sm", render: (row) => humanise(row.section) },
          {
            key: "flags",
            header: "",
            render: (row) => (
              <div className="flex flex-wrap gap-1">
                {row.required && <Badge tone="brand">Required</Badge>}
                {row.unique && <Badge tone="neutral">Unique</Badge>}
                {row.isSensitive && <Badge tone="warning">Sensitive</Badge>}
                {row.employeeEditable && <Badge tone="info">Self-editable</Badge>}
                {!row.isActive && <Badge tone="neutral">Hidden</Badge>}
              </div>
            ),
          },
        ]}
        fields={[
          {
            path: "key",
            label: "Key",
            required: true,
            placeholder: "uniform_size",
            hint: "Lowercase letters, numbers and underscores. Cannot be changed later.",
          },
          { path: "label", label: "Label", required: true, placeholder: "Uniform Size" },
          {
            path: "type",
            label: "Type",
            type: "select",
            required: true,
            options: [
              "text",
              "textarea",
              "number",
              "date",
              "dropdown",
              "multiselect",
              "boolean",
              "email",
              "phone",
              "currency",
            ].map((value) => ({ value, label: humanise(value) })),
          },
          {
            path: "section",
            label: "Appears under",
            type: "select",
            options: ["personal", "employment", "statutory", "bank", "other"].map((value) => ({
              value,
              label: humanise(value),
            })),
          },
          { path: "helpText", label: "Help text", type: "textarea" },
          { path: "order", label: "Display order", type: "number", min: 1 },
          { path: "required", label: "Required", type: "checkbox" },
          { path: "unique", label: "Must be unique across employees", type: "checkbox" },
          {
            path: "isSensitive",
            label: "Sensitive — hide unless the viewer can see salary and identity data",
            type: "checkbox",
            colSpan: 2,
          },
          {
            path: "employeeEditable",
            label: "Employees can edit this themselves",
            type: "checkbox",
            colSpan: 2,
          },
        ]}
        defaults={{ type: "text", section: "other", order: 100, isActive: true }}
      />
    </>
  );
}
