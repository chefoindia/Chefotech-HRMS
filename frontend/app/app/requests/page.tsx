"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Plus, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useListQuery, useListState } from "@/lib/hooks";
import { Button, Card, EmptyState, FilterSelect, NoAccessState, PageHeader, TableToolbar, Tabs, useToast } from "@/components/ui";
import { DecisionDialog } from "@/components/modules/DecisionDialog";
import { RequestForm } from "@/components/modules/RequestForm";
import { RequestRow } from "@/components/modules/RequestCard";
import { EmployeeMultiPicker } from "@/components/documents/EmployeePicker";
import { REQUEST_TYPES, type EmployeeRequest } from "@/lib/moduleTypes";

/** Employee requests for managers and HR: decide, or raise one for someone. */
export default function RequestsAdminPage() {
  const { session, can, canAny } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const locale = session?.organization?.locale || "en-IN";
  const [tab, setTab] = useState("to_approve");
  const state = useListState();
  const [deciding, setDeciding] = useState<{ request: EmployeeRequest; decision: "approve" | "reject" } | null>(null);
  const [creatingFor, setCreatingFor] = useState<string[] | null>(null);

  const { items, total, limit, isLoading, error, refetch } = useListQuery<EmployeeRequest>("requests", "/requests", state, {
    limit: 30,
    extraQuery: { scope: tab },
    enabled: canAny("request.approve", "request.view"),
  });

  const decide = useMutation({
    mutationFn: ({ id, decision, comment }: { id: string; decision: "approve" | "reject"; comment: string }) => api.post(`/requests/${id}/decide`, { decision, comment }),
    onSuccess: (_, v) => {
      toast.success(v.decision === "approve" ? "Approved" : "Rejected", "The employee has been told.");
      setDeciding(null);
      queryClient.invalidateQueries({ queryKey: ["requests"] });
    },
    onError: (error) => toast.fromError(error, "Could not record that decision."),
  });

  const retry = useMutation({
    mutationFn: (id: string) => api.post(`/requests/${id}/retry`),
    onSuccess: () => {
      toast.success("Applied");
      queryClient.invalidateQueries({ queryKey: ["requests"] });
    },
    onError: (error) => toast.fromError(error, "Still could not apply it."),
  });

  if (!canAny("request.approve", "request.view")) return <NoAccessState what="employee requests" />;

  return (
    <>
      <PageHeader
        title="Employee requests"
        description="Work from home, comp-off, encashment, shift changes, letters and detail changes — decide them here, or raise one on someone's behalf."
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreatingFor([])}>
            Raise for an employee
          </Button>
        }
      />

      <Tabs
        items={[
          { key: "to_approve", label: "Waiting on me" },
          ...(can("request.view") ? [{ key: "all", label: "All requests" }] : []),
        ]}
        active={tab}
        onChange={(key) => {
          setTab(key);
          state.setPage(1);
        }}
        className="mb-5"
      />

      <div className="mb-4">
        <TableToolbar
          filters={
            <>
              <FilterSelect value={state.filters.type || ""} onChange={(v) => state.setFilter("type", v)} placeholder="All types" options={REQUEST_TYPES.map((t) => ({ value: t, label: t.replace(/_/g, " ") }))} />
              {tab === "all" && (
                <FilterSelect
                  value={state.filters.status || ""}
                  onChange={(v) => state.setFilter("status", v)}
                  placeholder="All statuses"
                  options={["pending", "approved", "completed", "rejected", "cancelled"].map((s) => ({ value: s, label: s }))}
                />
              )}
            </>
          }
          activeFilterCount={state.activeFilterCount}
          onClearFilters={state.clearFilters}
          actions={
            <Button variant="ghost" size="sm" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => refetch()}>
              Refresh
            </Button>
          }
        />
      </div>

      {isLoading ? (
        <div className="skeleton h-40" />
      ) : error ? (
        <Card>
          <EmptyState title="Could not load requests" description={(error as Error).message} />
        </Card>
      ) : !items.length ? (
        <Card>
          <EmptyState icon={<ClipboardList className="h-6 w-6" />} title={tab === "to_approve" ? "Nothing waiting on you" : "No requests match"} description="When someone on your team asks for something, it appears here." />
        </Card>
      ) : (
        <Card padded={false}>
          <ul className="divide-y">
            {items.map((request) => (
              <RequestRow
                key={request.id}
                request={request}
                locale={locale}
                showEmployee
                actions={
                  request.status === "pending" && !request.viaWorkflow ? (
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => setDeciding({ request, decision: "reject" })}>
                        Reject
                      </Button>
                      <Button size="sm" onClick={() => setDeciding({ request, decision: "approve" })}>
                        Approve
                      </Button>
                    </div>
                  ) : request.status === "approved" && request.effect && (request.effect as { error?: string }).error && can("request.approve") ? (
                    <Button size="sm" variant="outline" loading={retry.isPending} onClick={() => retry.mutate(request.id)}>
                      Retry applying
                    </Button>
                  ) : undefined
                }
              />
            ))}
          </ul>
          {total > limit && (
            <div className="flex items-center justify-between border-t px-5 py-3 text-[12.5px] text-[var(--text-muted)]">
              <span>
                Page {state.page} of {Math.ceil(total / limit)}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={state.page <= 1} onClick={() => state.setPage(state.page - 1)}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={state.page * limit >= total} onClick={() => state.setPage(state.page + 1)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {deciding && (
        <DecisionDialog
          title={`${deciding.decision === "approve" ? "Approve" : "Reject"}: ${deciding.request.summary}`}
          decision={deciding.decision}
          loading={decide.isPending}
          onClose={() => setDeciding(null)}
          onConfirm={(comment) => decide.mutate({ id: deciding.request.id, decision: deciding.decision, comment })}
        >
          <p className="text-[13px] text-[var(--text-muted)]">
            {deciding.request.employee?.name} · {deciding.request.typeLabel}
            {deciding.request.reason ? ` — “${deciding.request.reason}”` : ""}
          </p>
        </DecisionDialog>
      )}

      {creatingFor && creatingFor.length === 0 && (
        <PickEmployeeThenForm onClose={() => setCreatingFor(null)} />
      )}
    </>
  );
}

function PickEmployeeThenForm({ onClose }: { onClose: () => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState<string | null>(null);
  if (confirmed) return <RequestForm employeeId={confirmed} onClose={onClose} onDone={onClose} />;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-[var(--radius)] border bg-[var(--surface)] p-5 shadow-xl">
        <h3 className="text-[15px] font-semibold text-[var(--text)]">Who is this request for?</h3>
        <div className="mt-3">
          <EmployeeMultiPicker selected={selected} onChange={(ids) => setSelected(ids.slice(-1))} maxHeight="14rem" />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!selected.length} onClick={() => setConfirmed(selected[0])}>
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}
