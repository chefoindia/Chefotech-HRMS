"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { useListQuery, useListState } from "@/lib/hooks";
import { formatDate, formatRelative, humanise } from "@/lib/format";
import { Badge, Button, DataTable, FilterSelect, TableToolbar, useToast, type Column } from "@/components/ui";
import type { DocumentRequest, EmployeeDocument } from "@/lib/documentTemplateTypes";
import { EmployeeMultiPicker } from "./EmployeePicker";
import { RequestDialog } from "./EmployeeDocumentsPanel";

/** Every document HR has asked employees for, across the organization. */
export function DocumentRequestsPanel({ locale }: { locale: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const state = useListState({ filters: { status: "pending" } });
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const { items, total, limit, isLoading, error, refetch } = useListQuery<DocumentRequest>("documents-requests", "/documents/requests", state, { limit: 25 });

  const cancel = useMutation({
    mutationFn: (request: DocumentRequest) => api.post(`/documents/requests/${request.id}/cancel`),
    onSuccess: () => {
      toast.success("Request cancelled");
      queryClient.invalidateQueries({ queryKey: ["documents-requests"] });
    },
    onError: (err) => toast.fromError(err, "Could not cancel that request."),
  });

  const columns: Array<Column<DocumentRequest>> = [
    {
      key: "name",
      header: "Document",
      render: (row) => (
        <div>
          <p className="font-medium text-[var(--text)]">{row.name}</p>
          <p className="text-[12px] text-[var(--text-muted)]">{humanise(row.category)}</p>
        </div>
      ),
    },
    {
      key: "employee",
      header: "Employee",
      render: (row) =>
        row.employee ? (
          <Link href={`/app/employees/${row.employee.id}`} className="text-brand-700 hover:underline">
            {row.employee.name} <span className="text-[var(--text-subtle)]">({row.employee.employeeCode})</span>
          </Link>
        ) : (
          "—"
        ),
    },
    { key: "requestedBy", header: "Asked by", hideBelow: "md", render: (row) => row.requestedBy || "—" },
    { key: "createdAt", header: "Asked", hideBelow: "md", render: (row) => formatRelative(row.createdAt) },
    { key: "dueOn", header: "Due", render: (row) => (row.dueOn ? formatDate(row.dueOn, { locale }) : "—") },
    {
      key: "status",
      header: "Status",
      render: (row) =>
        row.status === "pending" ? row.isOverdue ? <Badge tone="danger">Overdue</Badge> : <Badge tone="warning">Pending</Badge> : row.status === "fulfilled" ? <Badge tone="success">Uploaded {row.fulfilledAt ? formatRelative(row.fulfilledAt) : ""}</Badge> : <Badge tone="neutral">Cancelled</Badge>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) =>
        row.status === "pending" ? (
          <Button variant="ghost" size="sm" onClick={() => cancel.mutate(row)}>
            Cancel
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        rows={items}
        rowKey={(row) => row.id}
        loading={isLoading}
        error={error ? (error as Error).message : null}
        onRetry={refetch}
        page={state.page}
        limit={limit}
        total={total}
        onPageChange={state.setPage}
        emptyIcon={<ClipboardList className="h-6 w-6" />}
        emptyTitle="No requests"
        emptyDescription="Ask an employee — or a whole department — to upload a document, and track it here."
        toolbar={
          <TableToolbar
            filters={
              <FilterSelect
                value={state.filters.status || ""}
                onChange={(v) => state.setFilter("status", v)}
                placeholder="All statuses"
                options={[
                  { value: "pending", label: "Pending" },
                  { value: "fulfilled", label: "Uploaded" },
                  { value: "cancelled", label: "Cancelled" },
                ]}
              />
            }
            activeFilterCount={state.activeFilterCount}
            onClearFilters={state.clearFilters}
            actions={
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
                Request documents
              </Button>
            }
          />
        }
      />

      {creating && (
        <RequestDialog
          employeeIds={selected}
          picker={<EmployeeMultiPicker selected={selected} onChange={setSelected} maxHeight="14rem" />}
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            setSelected([]);
            queryClient.invalidateQueries({ queryKey: ["documents-requests"] });
          }}
        />
      )}
    </>
  );
}

/** Documents waiting for an employee's acknowledgement. */
export function AcknowledgementsPanel({ locale }: { locale: string }) {
  const state = useListState();
  const { items, total, limit, isLoading, error, refetch } = useListQuery<EmployeeDocument & { employee?: { _id?: string; id?: string; employeeCode: string; personal: { firstName: string; lastName: string } } }>(
    "documents-acknowledgements",
    "/documents/acknowledgements/pending",
    state,
    { limit: 25 }
  );

  const columns: Array<Column<(typeof items)[number]>> = [
    {
      key: "name",
      header: "Document",
      render: (row) => (
        <div>
          <p className="font-medium text-[var(--text)]">{row.name}</p>
          <p className="text-[12px] text-[var(--text-muted)]">{humanise(row.category)}</p>
        </div>
      ),
    },
    {
      key: "employee",
      header: "Employee",
      render: (row) => {
        const e = row.employee;
        if (!e) return "—";
        const id = e.id || e._id;
        return (
          <Link href={`/app/employees/${id}`} className="text-brand-700 hover:underline">
            {[e.personal.firstName, e.personal.lastName].filter(Boolean).join(" ")} <span className="text-[var(--text-subtle)]">({e.employeeCode})</span>
          </Link>
        );
      },
    },
    { key: "requestedAt", header: "Asked", hideBelow: "md", render: (row) => (row.acknowledgement.requestedAt ? formatRelative(row.acknowledgement.requestedAt) : "—") },
    { key: "dueOn", header: "Due", render: (row) => (row.acknowledgement.dueOn ? formatDate(row.acknowledgement.dueOn, { locale }) : "—") },
    { key: "state", header: "Status", render: (row) => (row.acknowledgement.isOverdue ? <Badge tone="danger">Overdue</Badge> : <Badge tone="warning">Pending</Badge>) },
  ];

  return (
    <DataTable
      columns={columns}
      rows={items}
      rowKey={(row) => row.id}
      loading={isLoading}
      error={error ? (error as Error).message : null}
      onRetry={refetch}
      page={state.page}
      limit={limit}
      total={total}
      onPageChange={state.setPage}
      emptyTitle="Nothing waiting"
      emptyDescription="When you ask an employee to acknowledge a letter or policy, it sits here until they do. Reminders go out every three days."
      toolbar={
        <TableToolbar
          filters={
            <FilterSelect
              value={state.filters.overdue || ""}
              onChange={(v) => state.setFilter("overdue", v)}
              placeholder="Pending and overdue"
              options={[{ value: "true", label: "Overdue only" }]}
            />
          }
          activeFilterCount={state.activeFilterCount}
          onClearFilters={state.clearFilters}
        />
      }
    />
  );
}
