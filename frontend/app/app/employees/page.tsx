"use client";

import { useRouter } from "next/navigation";
import { Download, Plus, Upload, Users } from "lucide-react";
import { useSession } from "@/lib/session";
import { useListQuery, useListState, useReferenceData, toOptions } from "@/lib/hooks";
import { api } from "@/lib/api";
import { formatDate, humanise } from "@/lib/format";
import { refLabel } from "@/lib/utils";
import {
  Button,
  DataTable,
  FilterSelect,
  LinkButton,
  PageHeader,
  PersonCell,
  StatusBadge,
  TableToolbar,
  useToast,
  type Column,
} from "@/components/ui";
import type { Employee } from "@/lib/types";

const STATUS_OPTIONS = [
  "active",
  "on_leave",
  "notice_period",
  "suspended",
  "invited",
  "draft",
  "resigned",
  "terminated",
  "inactive",
].map((value) => ({ value, label: humanise(value) }));

const TYPE_OPTIONS = [
  "full_time",
  "part_time",
  "contract",
  "intern",
  "consultant",
  "temporary",
].map((value) => ({ value, label: humanise(value) }));

export default function EmployeesPage() {
  const router = useRouter();
  const toast = useToast();
  const { session, can } = useSession();
  const locale = session?.organization?.locale || "en-IN";

  const state = useListState({ sort: "employeeCode" });
  const reference = useReferenceData();

  const { items, total, limit, isLoading, error, refetch } = useListQuery<Employee>(
    "employees",
    "/employees",
    state,
    { extraQuery: { includeInactive: state.filters.status ? "true" : undefined } }
  );

  const exportList = async () => {
    try {
      await api.download("/reports/employee_directory/run", {
        format: "xlsx",
        ...state.filters,
      });
      toast.success("Export started", "Your download should begin shortly.");
    } catch (err) {
      toast.fromError(err, "Could not export the employee list.");
    }
  };

  const columns: Array<Column<Employee>> = [
    {
      key: "employeeCode",
      header: "Employee",
      sortable: true,
      render: (row) => (
        <PersonCell
          name={row.fullName}
          code={row.employeeCode}
          avatarUrl={row.avatarUrl}
          subtitle={row.personal?.workEmail || undefined}
        />
      ),
    },
    {
      key: "designation",
      header: "Designation",
      hideBelow: "md",
      render: (row) => refLabel(row.employment?.designationId),
    },
    {
      key: "department",
      header: "Department",
      hideBelow: "sm",
      render: (row) => refLabel(row.employment?.departmentId),
    },
    {
      key: "location",
      header: "Location",
      hideBelow: "lg",
      render: (row) => refLabel(row.employment?.locationId),
    },
    {
      key: "employment.joiningDate",
      header: "Joined",
      hideBelow: "lg",
      sortable: true,
      render: (row) => formatDate(row.employment?.joiningDate, { locale }),
    },
    {
      key: "status",
      header: "Status",
      sortable: true,
      render: (row) => <StatusBadge status={row.status} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="Employees"
        description={
          total > 0
            ? `${total.toLocaleString()} ${total === 1 ? "person" : "people"} matching your filters.`
            : "Everyone in your organization."
        }
        actions={
          <>
            {can("employee.export") && (
              <Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={exportList}>
                Export
              </Button>
            )}
            {can("employee.import") && (
              <LinkButton
                href="/app/employees/import"
                variant="outline"
                icon={<Upload className="h-4 w-4" />}
              >
                Import
              </LinkButton>
            )}
            {can("employee.create") && (
              <LinkButton
                href="/app/employees/new"
                icon={<Plus className="h-4 w-4" />}
                data-tour="employee-add"
              >
                Add employee
              </LinkButton>
            )}
          </>
        }
      />

      <DataTable
        columns={columns}
        rows={items}
        rowKey={(row) => row.id}
        loading={isLoading}
        error={error ? (error as Error).message : null}
        onRetry={refetch}
        onRowClick={(row) => router.push(`/app/employees/${row.id}`)}
        page={state.page}
        limit={limit}
        total={total}
        onPageChange={state.setPage}
        sort={state.sort}
        onSortChange={state.setSort}
        emptyIcon={<Users className="h-6 w-6" />}
        emptyTitle={state.activeFilterCount ? "No one matches those filters" : "No employees yet"}
        emptyDescription={
          state.activeFilterCount
            ? "Try clearing a filter or searching for something else."
            : "Add your first employee, or import your existing list from a spreadsheet."
        }
        emptyAction={
          state.activeFilterCount ? (
            <Button variant="outline" size="sm" onClick={state.clearFilters}>
              Clear filters
            </Button>
          ) : can("employee.create") ? (
            <LinkButton href="/app/employees/new" size="sm" icon={<Plus className="h-4 w-4" />}>
              Add employee
            </LinkButton>
          ) : undefined
        }
        toolbar={
          <TableToolbar
            search={state.search}
            onSearchChange={state.setSearch}
            placeholder="Search by name, code, email or device ID"
            activeFilterCount={state.activeFilterCount}
            onClearFilters={state.clearFilters}
            filters={
              <>
                <FilterSelect
                  value={state.filters.departmentId || ""}
                  onChange={(value) => state.setFilter("departmentId", value)}
                  options={toOptions(reference.departments)}
                  placeholder="All departments"
                />
                <FilterSelect
                  value={state.filters.locationId || ""}
                  onChange={(value) => state.setFilter("locationId", value)}
                  options={toOptions(reference.locations)}
                  placeholder="All locations"
                />
                <FilterSelect
                  value={state.filters.status || ""}
                  onChange={(value) => state.setFilter("status", value)}
                  options={STATUS_OPTIONS}
                  placeholder="Any status"
                />
                <FilterSelect
                  value={state.filters.employmentType || ""}
                  onChange={(value) => state.setFilter("employmentType", value)}
                  options={TYPE_OPTIONS}
                  placeholder="Any type"
                />
              </>
            }
          />
        }
      />
    </>
  );
}
