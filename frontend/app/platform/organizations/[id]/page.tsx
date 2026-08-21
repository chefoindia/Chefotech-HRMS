"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  DetailGrid,
  DetailItem,
  PageLoader,
  useToast,
} from "@/components/ui";

interface OrgDetail {
  id: string;
  name: string;
  slug: string;
  email?: string;
  status: string;
  suspendedReason?: string | null;
  plan?: { code?: string; status?: string; trialEndsAt?: string | null };
  industry?: string;
  companySize?: string;
  country?: string;
  timezone?: string;
  onboarding?: { status?: string };
  usage?: { employees: number; activeEmployees: number; users: number; storageMb: number };
  owner?: { email: string; firstName?: string; lastName?: string; lastLoginAt?: string } | null;
  createdAt: string;
}

/**
 * One customer organisation.
 *
 * Suspension lives here rather than as a row action in the list, because it
 * cuts off a live business's access to their own payroll. It requires a
 * confirmation and a written reason, and the reason is shown back on this page
 * afterwards — so whoever looks next can see why, not just that.
 */
export default function PlatformOrganizationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const toast = useToast();
  const queryClient = useQueryClient();

  const [confirming, setConfirming] = useState<"suspend" | "reactivate" | null>(null);
  const [reason, setReason] = useState("");

  const { data, isLoading, error } = useQuery<OrgDetail>({
    queryKey: ["platform", "organization", id],
    queryFn: async () => (await api.get<OrgDetail>(`/platform/organizations/${id}`)).data,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["platform", "organization", id] });
    queryClient.invalidateQueries({ queryKey: ["platform", "organizations"] });
    queryClient.invalidateQueries({ queryKey: ["platform", "overview"] });
  };

  const suspend = useMutation({
    mutationFn: () => api.post(`/platform/organizations/${id}/suspend`, { reason }),
    onSuccess: () => {
      toast.success("Organisation suspended.");
      setConfirming(null);
      setReason("");
      invalidate();
    },
    onError: () => toast.error("Could not suspend that organisation."),
  });

  const reactivate = useMutation({
    mutationFn: () => api.post(`/platform/organizations/${id}/reactivate`, {}),
    onSuccess: () => {
      toast.success("Organisation reactivated.");
      setConfirming(null);
      invalidate();
    },
    onError: () => toast.error("Could not reactivate that organisation."),
  });

  if (isLoading) return <PageLoader label="Loading organisation…" />;

  if (error || !data) {
    return (
      <Card>
        <p className="text-[14px] text-[var(--text-muted)]">
          That organisation could not be loaded. It may have been deleted.
        </p>
        <Link
          href="/platform/organizations"
          className="mt-3 inline-block text-[13.5px] font-medium text-brand-700 hover:underline"
        >
          Back to all organisations
        </Link>
      </Card>
    );
  }

  const suspended = data.status === "suspended";

  return (
    <>
      <Link
        href="/platform/organizations"
        className="inline-flex items-center gap-1.5 text-[13px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        All organisations
      </Link>

      <header className="mb-6 mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-[var(--text)]">
            {data.name}
          </h1>
          <p className="mt-1 font-mono text-[13px] text-[var(--text-muted)]">{data.slug}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={suspended ? "danger" : data.status === "active" ? "success" : "warning"}>
            {data.status}
          </Badge>
          {suspended ? (
            <Button variant="outline" onClick={() => setConfirming("reactivate")}>
              Reactivate
            </Button>
          ) : (
            <Button variant="danger" onClick={() => setConfirming("suspend")}>
              Suspend
            </Button>
          )}
        </div>
      </header>

      {suspended && data.suspendedReason && (
        <Card className="mb-5">
          <p className="text-[13.5px] text-[var(--text-muted)]">
            <span className="font-medium text-[var(--text)]">Suspended because: </span>
            {data.suspendedReason}
          </p>
        </Card>
      )}

      <Card className="mb-5">
        <CardHeader title="Account" />
        <div className="mt-4">
          <DetailGrid>
            <DetailItem label="Plan" value={data.plan?.code ?? "—"} />
            <DetailItem label="Plan status" value={data.plan?.status ?? "—"} />
            <DetailItem
              label="Trial ends"
              value={
                data.plan?.trialEndsAt
                  ? new Date(data.plan.trialEndsAt).toLocaleDateString()
                  : "—"
              }
            />
            <DetailItem label="Contact email" value={data.email ?? "—"} />
            <DetailItem label="Industry" value={data.industry ?? "—"} />
            <DetailItem label="Company size" value={data.companySize ?? "—"} />
            <DetailItem label="Country" value={data.country ?? "—"} />
            <DetailItem label="Timezone" value={data.timezone ?? "—"} />
            <DetailItem label="Onboarding" value={data.onboarding?.status ?? "—"} />
            <DetailItem
              label="Signed up"
              value={new Date(data.createdAt).toLocaleDateString()}
            />
          </DetailGrid>
        </div>
      </Card>

      <div className="grid gap-5 sm:grid-cols-2">
        <Card>
          <CardHeader title="Usage" description="Read from inside the tenant." />
          <div className="mt-4">
            <DetailGrid>
              <DetailItem label="Employee records" value={String(data.usage?.employees ?? 0)} />
              <DetailItem label="Active employees" value={String(data.usage?.activeEmployees ?? 0)} />
              <DetailItem label="Users" value={String(data.usage?.users ?? 0)} />
              <DetailItem label="Storage" value={`${data.usage?.storageMb ?? 0} MB`} />
            </DetailGrid>
          </div>
        </Card>

        <Card>
          <CardHeader title="Owner" />
          <div className="mt-4">
            {data.owner ? (
              <DetailGrid>
                <DetailItem
                  label="Name"
                  value={
                    [data.owner.firstName, data.owner.lastName].filter(Boolean).join(" ") || "—"
                  }
                />
                <DetailItem label="Email" value={data.owner.email} />
                <DetailItem
                  label="Last signed in"
                  value={
                    data.owner.lastLoginAt
                      ? new Date(data.owner.lastLoginAt).toLocaleString()
                      : "Never"
                  }
                />
              </DetailGrid>
            ) : (
              <p className="text-[13.5px] text-[var(--text-subtle)]">
                No owner is recorded for this organisation.
              </p>
            )}
          </div>
        </Card>
      </div>

      <ConfirmDialog
        open={confirming === "suspend"}
        onClose={() => setConfirming(null)}
        title="Suspend this organisation?"
        confirmLabel="Suspend"
        tone="danger"
        loading={suspend.isPending}
        onConfirm={() => {
          suspend.mutate();
        }}
        message={
          <>
            <p className="text-[13.5px] leading-relaxed text-[var(--text-muted)]">
              Everyone at {data.name} will lose access immediately, including to their own
              payslips and attendance. Their data is retained and nothing is deleted.
            </p>
            <label className="mt-4 block text-[13px] font-medium text-[var(--text)]">
              Reason (recorded, and shown to whoever looks at this next)
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={3}
                className="mt-1 w-full rounded-lg border bg-[var(--surface)] px-3 py-2 text-[13.5px] outline-none focus:border-brand-500"
                placeholder="e.g. Non-payment after three reminders, ticket #1421"
              />
            </label>
          </>
        }
      />

      <ConfirmDialog
        open={confirming === "reactivate"}
        onClose={() => setConfirming(null)}
        title="Reactivate this organisation?"
        confirmLabel="Reactivate"
        loading={reactivate.isPending}
        onConfirm={() => {
          reactivate.mutate();
        }}
        message={
          <p className="text-[13.5px] leading-relaxed text-[var(--text-muted)]">
            Access is restored for everyone at {data.name}, with their configuration exactly as
            it was before suspension.
          </p>
        }
      />
    </>
  );
}
