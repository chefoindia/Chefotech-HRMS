"use client";

import { BadgeCheck } from "lucide-react";
import { useSession } from "@/lib/session";
import { useReferenceData } from "@/lib/hooks";
import { refLabel } from "@/lib/utils";
import { NoAccessState } from "@/components/ui";
import { MasterDataPage } from "@/components/data/MasterDataPage";
import type { Designation } from "@/lib/types";

export default function DesignationsPage() {
  const { can } = useSession();
  const reference = useReferenceData(can("designation.view"));

  if (!can("designation.view")) return <NoAccessState what="designations" />;

  return (
    <MasterDataPage<Designation>
      title="Designations"
      description="Job titles and grades. The level decides seniority in default approval chains, where 1 is the most senior."
      resource="/designations"
      queryKey="designations"
      entityName="Designation"
      aiEntity="designation"
      can={can}
      permissions={{ view: "designation.view", manage: "designation.manage" }}
      emptyIcon={<BadgeCheck className="h-6 w-6" />}
      emptyDescription="Add the job titles used in your organization."
      columns={[
        { key: "name", header: "Designation", sortable: true },
        {
          key: "code",
          header: "Code",
          render: (row) => <span className="font-mono text-[12.5px]">{row.code}</span>,
        },
        { key: "grade", header: "Grade", hideBelow: "sm", render: (row) => row.grade || "—" },
        { key: "level", header: "Level", align: "right", sortable: true },
        {
          key: "department",
          header: "Department",
          hideBelow: "md",
          render: (row) => refLabel(row.departmentId, "Any"),
        },
        {
          key: "employeeCount",
          header: "People",
          align: "right",
          render: (row) => row.employeeCount || 0,
        },
      ]}
      fields={[
        { path: "name", label: "Name", required: true, placeholder: "Team Lead" },
        { path: "code", label: "Code", required: true, placeholder: "TL" },
        { path: "grade", label: "Grade", placeholder: "S1" },
        {
          path: "level",
          label: "Level",
          type: "number",
          min: 1,
          max: 20,
          hint: "1 is the most senior.",
        },
        {
          path: "departmentId",
          label: "Department",
          type: "select",
          placeholder: "Any department",
          options: reference.departments.map((d) => ({ value: d.id, label: d.name })),
        },
        { path: "description", label: "Description", type: "textarea" },
      ]}
      defaults={{ level: 5, isActive: true }}
    />
  );
}
