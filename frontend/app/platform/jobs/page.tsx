"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import {
  Card,
  CardHeader,
  DataTable,
  Badge,
  Button,
  FilterSelect,
  useToast,
} from "@/components/ui";
import type { Column } from "@/components/ui";
import type { Paged } from "@/lib/types";

interface Job {
  _id: string;
  name: string;
  status: string;
  attempts?: number;
  maxAttempts?: number;
  runAt?: string;
  lastError?: string;
  createdAt: string;
}

/**
 * The background job queue.
 *
 * A failed job is invisible to the tenant whose payroll or import it was
 * running, so this is where someone finds out that a customer's overnight
 * work did not happen. Retry is offered because the queue is at-least-once
 * and its handlers are idempotent by design — re-running a job is safe.
 */
export default function PlatformJobsPage() {
  const [status, setStatus] = useState("");
  const toast = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch, isFetching } = useQuery<Paged<Job>>({
    queryKey: ["platform", "jobs", { status }],
    queryFn: async () =>
      (
        await api.get<Paged<Job>>("/platform/jobs", {
          query: { status: status || undefined, limit: 50 },
        })
      ).data,
    refetchInterval: 30_000,
  });

  const retry = useMutation({
    mutationFn: (id: string) => api.post(`/platform/jobs/${id}/retry`, {}),
    onSuccess: () => {
      toast.success("Job queued for another attempt.");
      queryClient.invalidateQueries({ queryKey: ["platform", "jobs"] });
    },
    onError: () => toast.error("Could not retry that job."),
  });

  const columns: Column<Job>[] = [
    {
      key: "name",
      header: "Job",
      render: (row) => <span className="font-mono text-[12.5px]">{row.name}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <Badge
          tone={
            row.status === "completed"
              ? "success"
              : row.status === "failed"
                ? "danger"
                : row.status === "running"
                  ? "info"
                  : "neutral"
          }
        >
          {row.status}
        </Badge>
      ),
    },
    {
      key: "attempts",
      header: "Attempts",
      align: "right",
      render: (row) => `${row.attempts ?? 0}/${row.maxAttempts ?? 1}`,
    },
    {
      key: "lastError",
      header: "Last error",
      render: (row) =>
        row.lastError ? (
          <span className="text-[12.5px] text-[var(--danger,#dc2626)]" title={row.lastError}>
            {row.lastError.slice(0, 70)}
            {row.lastError.length > 70 ? "…" : ""}
          </span>
        ) : (
          <span className="text-[var(--text-subtle)]">—</span>
        ),
    },
    {
      key: "createdAt",
      header: "Created",
      render: (row) => new Date(row.createdAt).toLocaleString(),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) =>
        row.status === "failed" ? (
          <Button size="sm" variant="outline" onClick={() => retry.mutate(row._id)}>
            Retry
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-[var(--text)]">
            Background jobs
          </h1>
          <p className="mt-1 text-[14px] text-[var(--text-muted)]">
            Scheduled and queued work across every organisation. Refreshes automatically.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => refetch()}
          icon={<RefreshCw className={isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />}
        >
          Refresh
        </Button>
      </header>

      <Card>
        <CardHeader
          title="Queue"
          action={
            <FilterSelect
              value={status}
              onChange={setStatus}
              placeholder="Any status"
              options={[
                { value: "pending", label: "Pending" },
                { value: "running", label: "Running" },
                { value: "completed", label: "Completed" },
                { value: "failed", label: "Failed" },
              ]}
            />
          }
        />
        <div className="mt-4">
          <DataTable
            rows={data?.items ?? []}
            columns={columns}
            loading={isLoading}
            error={error ? "Could not load the job queue." : null}
            rowKey={(row) => row._id}
            emptyTitle="Nothing queued"
            emptyDescription="No background jobs match these filters."
          />
        </div>
      </Card>
    </>
  );
}
