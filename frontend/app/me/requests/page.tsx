"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button, Card, ConfirmDialog, EmptyState, PageHeader, Tabs, useToast } from "@/components/ui";
import { RequestForm } from "@/components/modules/RequestForm";
import { RequestRow } from "@/components/modules/RequestCard";
import type { EmployeeRequest } from "@/lib/moduleTypes";

/**
 * My requests: work from home, comp-off, encashment, shift changes,
 * letters, detail changes, advances. Leave has its own screen.
 */
export default function MyRequestsPage() {
  const { session, can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const locale = session?.organization?.locale || "en-IN";
  const [tab, setTab] = useState("pending");
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState<EmployeeRequest | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["requests", "mine"],
    queryFn: async () => (await api.get<EmployeeRequest[]>("/requests", { query: { scope: "mine", limit: 100 } })).data,
    enabled: Boolean(session?.employeeId),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/requests/${id}/cancel`),
    onSuccess: () => {
      toast.success("Request withdrawn");
      setCancelling(null);
      queryClient.invalidateQueries({ queryKey: ["requests"] });
    },
    onError: (error) => toast.fromError(error, "Could not withdraw that request."),
  });

  const rows = data || [];
  const pending = rows.filter((r) => r.status === "pending");
  const done = rows.filter((r) => r.status !== "pending");
  const shown = tab === "pending" ? pending : done;

  return (
    <>
      <PageHeader
        title="My requests"
        description="Work from home, comp-off, leave encashment, shift changes, letters and changes to your details."
        actions={
          can("request.submit") && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              New request
            </Button>
          )
        }
      />

      <Tabs items={[{ key: "pending", label: "Waiting", count: pending.length }, { key: "done", label: "Decided", count: done.length }]} active={tab} onChange={setTab} className="mb-5" />

      {isLoading ? (
        <div className="skeleton h-32" />
      ) : !shown.length ? (
        <Card>
          <EmptyState icon={<ClipboardList className="h-6 w-6" />} title={tab === "pending" ? "Nothing waiting" : "No decided requests yet"} description="Ask for a day of work from home, claim a comp-off for a weekend worked, or request a letter — it goes to the right person and you are told when it is decided." action={can("request.submit") ? <Button onClick={() => setCreating(true)}>New request</Button> : undefined} />
        </Card>
      ) : (
        <Card padded={false}>
          <ul className="divide-y">
            {shown.map((request) => (
              <RequestRow
                key={request.id}
                request={request}
                locale={locale}
                actions={
                  request.status === "pending" ? (
                    <Button variant="ghost" size="sm" onClick={() => setCancelling(request)}>
                      Withdraw
                    </Button>
                  ) : undefined
                }
              />
            ))}
          </ul>
        </Card>
      )}

      {creating && <RequestForm onClose={() => setCreating(false)} onDone={() => setCreating(false)} />}
      <ConfirmDialog
        open={Boolean(cancelling)}
        onClose={() => setCancelling(null)}
        onConfirm={() => {
          if (cancelling) cancel.mutate(cancelling.id);
        }}
        loading={cancel.isPending}
        title="Withdraw this request?"
        confirmLabel="Withdraw"
        message={cancelling ? cancelling.summary : ""}
      />
    </>
  );
}
