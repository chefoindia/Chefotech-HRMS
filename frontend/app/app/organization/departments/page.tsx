"use client";

import { Building2 } from "lucide-react";
import { useSession } from "@/lib/session";
import { useReferenceData } from "@/lib/hooks";
import { refLabel } from "@/lib/utils";
import { Badge, NoAccessState } from "@/components/ui";
import { MasterDataPage } from "@/components/data/MasterDataPage";
import type { Department } from "@/lib/types";

export default function DepartmentsPage() {
  const { can } = useSession();
  const reference = useReferenceData(can("department.view"));

  if (!can("department.view")) return <NoAccessState what="departments" />;

  return (
    <MasterDataPage<Department>
      title="Departments"
      description="How your organization is divided. Departments can nest — Operations can contain Production, which can contain Cutting."
      resource="/departments"
      queryKey="departments"
      entityName="Department"
      aiEntity="department"
      can={can}
      permissions={{ view: "department.view", manage: "department.manage" }}
      emptyIcon={<Building2 className="h-6 w-6" />}
      emptyDescription="Add your first department. You can reorganise them later without losing any history."
      columns={[
        {
          key: "name",
          header: "Department",
          sortable: true,
          render: (row) => (
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-medium text-[var(--text)]">{row.name}</p>
              {row.description && (
                <p className="truncate text-[12px] text-[var(--text-muted)]">{row.description}</p>
              )}
            </div>
          ),
        },
        {
          key: "code",
          header: "Code",
          render: (row) => <span className="font-mono text-[12.5px]">{row.code}</span>,
        },
        {
          key: "parent",
          header: "Parent",
          hideBelow: "md",
          render: (row) =>
            row.parentId
              ? reference.departments.find((d) => d.id === row.parentId)?.name || "—"
              : "—",
        },
        {
          key: "employeeCount",
          header: "People",
          align: "right",
          render: (row) => row.employeeCount || 0,
        },
        {
          key: "isActive",
          header: "",
          align: "right",
          render: (row) => (row.isActive ? null : <Badge tone="neutral">Archived</Badge>),
        },
      ]}
      fields={[
        { path: "name", label: "Name", required: true, placeholder: "Operations" },
        {
          path: "code",
          label: "Code",
          required: true,
          placeholder: "OPS",
          hint: "Short and unique. Used when importing employees from a spreadsheet.",
        },
        {
          path: "parentId",
          label: "Sits under",
          type: "select",
          placeholder: "Top level",
          options: reference.departments.map((d) => ({ value: d.id, label: d.name })),
        },
        { path: "costCentre", label: "Cost centre", placeholder: "Optional" },
        { path: "description", label: "Description", type: "textarea" },
      ]}
      defaults={{ isActive: true }}
    />
  );
}
