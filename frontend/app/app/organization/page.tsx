"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BadgeCheck, Building2, MapPin, Network } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Card, PageHeader, StatCard } from "@/components/ui";

export default function OrganizationPage() {
  const { can } = useSession();

  const { data } = useQuery({
    queryKey: ["employees", "headcount"],
    queryFn: async () => {
      const { data: stats } = await api.get<{
        total: number;
        active: number;
        byDepartment: Array<{ name: string; count: number }>;
        byLocation: Array<{ name: string; count: number }>;
      }>("/employees/stats/headcount");
      return stats;
    },
    enabled: can("employee.view"),
  });

  const sections = [
    {
      href: "/app/organization/departments",
      icon: Building2,
      title: "Departments",
      description: "How the organization is divided. Departments can nest.",
      permission: "department.view",
    },
    {
      href: "/app/organization/designations",
      icon: BadgeCheck,
      title: "Designations",
      description: "Job titles and grades, and the seniority used by approvals.",
      permission: "designation.view",
    },
    {
      href: "/app/organization/locations",
      icon: MapPin,
      title: "Work locations",
      description: "Offices and sites, each with its own timezone and holidays.",
      permission: "location.view",
    },
    {
      href: "/app/organization/chart",
      icon: Network,
      title: "Org chart",
      description: "The reporting line, top to bottom.",
      permission: "employee.view",
    },
  ].filter((section) => can(section.permission));

  return (
    <>
      <PageHeader
        title="Organization"
        description="The structure everything else hangs off — departments, designations and locations."
      />

      {data && (
        <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Active employees" value={data.active} />
          <StatCard label="Total records" value={data.total} hint="Including past employees" />
          <StatCard label="Departments" value={data.byDepartment.length} />
          <StatCard label="Locations" value={data.byLocation.length} />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {sections.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="group card flex items-start gap-4 p-5 transition-colors hover:border-brand-300"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600">
              <section.icon className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14.5px] font-semibold text-[var(--text)]">{section.title}</p>
              <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">{section.description}</p>
            </div>
            <ArrowRight
              className="h-4 w-4 shrink-0 text-[var(--text-subtle)] transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </Link>
        ))}
      </div>
    </>
  );
}
