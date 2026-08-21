"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Network } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { refLabel } from "@/lib/utils";
import { Avatar, Card, EmptyState, NoAccessState, PageHeader, PageLoader } from "@/components/ui";
import type { Employee } from "@/lib/types";

interface Node {
  employee: Employee;
  reports: Node[];
}

/**
 * The org chart.
 *
 * Built client-side from one flat employee fetch rather than a recursive API
 * call per manager — for the organization sizes this product targets, one
 * query and a tree assembly is faster than N round trips and far simpler to
 * reason about.
 */
export default function OrgChartPage() {
  const { can } = useSession();

  const { data, isLoading } = useQuery({
    queryKey: ["employees", "chart"],
    queryFn: async () => {
      const { data: employees } = await api.get<Employee[]>("/employees", {
        query: { limit: 200, sort: "employeeCode" },
      });
      return employees;
    },
    enabled: can("employee.view"),
  });

  if (!can("employee.view")) return <NoAccessState what="the org chart" />;
  if (isLoading) return <PageLoader label="Building the chart" />;

  const employees = data || [];
  const byId = new Map(employees.map((employee) => [employee.id, employee]));

  const nodes = new Map<string, Node>(
    employees.map((employee) => [employee.id, { employee, reports: [] }])
  );

  const roots: Node[] = [];
  for (const employee of employees) {
    const managerId = refLabel(employee.employment.managerId) !== "—"
      ? (typeof employee.employment.managerId === "object"
          ? (employee.employment.managerId as { id?: string; _id?: string })?.id ||
            (employee.employment.managerId as { _id?: string })?._id
          : (employee.employment.managerId as string))
      : null;

    const node = nodes.get(employee.id)!;
    const parent = managerId ? nodes.get(managerId) : null;

    if (parent && parent !== node) parent.reports.push(node);
    else roots.push(node);
  }

  return (
    <>
      <PageHeader
        title="Org chart"
        description="Who reports to whom. Built from the manager on each employee's profile."
      />

      <Card>
        {!roots.length ? (
          <EmptyState
            icon={<Network className="h-6 w-6" />}
            title="No reporting lines yet"
            description="Set a manager on employee profiles and the chart builds itself."
          />
        ) : (
          <div className="space-y-1">
            {roots.map((node) => (
              <TreeNode key={node.employee.id} node={node} depth={0} />
            ))}
          </div>
        )}

        {employees.length >= 200 && (
          <p className="mt-4 text-[12.5px] text-[var(--text-muted)]">
            Showing the first 200 employees. Use the employee list to search beyond that.
          </p>
        )}
      </Card>
    </>
  );
}

function TreeNode({ node, depth }: { node: Node; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const hasReports = node.reports.length > 0;

  return (
    <div>
      <div
        className="flex items-center gap-2 rounded-md py-1.5 hover:bg-[var(--surface-muted)]"
        style={{ paddingLeft: `${depth * 24}px` }}
      >
        {hasReports ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-label={open ? "Collapse" : "Expand"}
            className="rounded p-0.5 text-[var(--text-subtle)] hover:bg-[var(--surface-sunken)]"
          >
            {open ? (
              <ChevronDown className="h-4 w-4" aria-hidden />
            ) : (
              <ChevronRight className="h-4 w-4" aria-hidden />
            )}
          </button>
        ) : (
          <span className="w-5" aria-hidden />
        )}

        <Link
          href={`/app/employees/${node.employee.id}`}
          className="flex min-w-0 flex-1 items-center gap-2.5"
        >
          <Avatar src={node.employee.avatarUrl} name={node.employee.fullName} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-[13.5px] font-medium text-[var(--text)]">
              {node.employee.fullName}
            </p>
            <p className="truncate text-[12px] text-[var(--text-muted)]">
              {refLabel(node.employee.employment.designationId, node.employee.employeeCode)}
              {hasReports && ` · ${node.reports.length} reporting`}
            </p>
          </div>
        </Link>
      </div>

      {open &&
        node.reports.map((child) => (
          <TreeNode key={child.employee.id} node={child} depth={depth + 1} />
        ))}
    </div>
  );
}
