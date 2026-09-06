"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Laptop } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatDate, humanise } from "@/lib/format";
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, useToast } from "@/components/ui";
import type { AssetAssignment } from "@/lib/moduleTypes";

/** What is in my care. */
export default function MyAssetsPage() {
  const { session } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const locale = session?.organization?.locale || "en-IN";
  const [acknowledging, setAcknowledging] = useState<AssetAssignment | null>(null);
  const [name, setName] = useState(session?.user.fullName || "");

  const { data, isLoading } = useQuery({
    queryKey: ["assets", "mine"],
    queryFn: async () => (await api.get<AssetAssignment[]>("/assets/me")).data,
  });

  const acknowledge = useMutation({
    mutationFn: (id: string) => api.post(`/assets/assignments/${id}/acknowledge`, { name }),
    onSuccess: () => {
      toast.success("Receipt confirmed");
      setAcknowledging(null);
      queryClient.invalidateQueries({ queryKey: ["assets", "mine"] });
    },
    onError: (error) => toast.fromError(error, "Could not confirm."),
  });

  return (
    <>
      <PageHeader title="My assets" description="Laptops, phones, cards and anything else the company has handed to you." />

      {isLoading ? (
        <div className="skeleton h-32" />
      ) : !data?.length ? (
        <Card>
          <EmptyState icon={<Laptop className="h-6 w-6" />} title="Nothing assigned to you" description="When IT or admin hands you equipment, it is listed here with what condition it was in and when it is due back." />
        </Card>
      ) : (
        <Card padded={false}>
          <ul className="divide-y">
            {data.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                <Laptop className="h-5 w-5 shrink-0 text-[var(--text-subtle)]" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium text-[var(--text)]">
                    {a.asset?.name} <span className="font-mono text-[12px] text-[var(--text-subtle)]">{a.asset?.tag}</span>
                  </p>
                  <p className="text-[12.5px] text-[var(--text-muted)]">
                    {humanise(a.asset?.category || "")}
                    {a.asset?.serialNumber ? ` · S/N ${a.asset.serialNumber}` : ""} · since {formatDate(a.assignedOn, { locale })}
                    {a.expectedReturnOn ? ` · due back ${formatDate(a.expectedReturnOn, { locale })}` : ""} · condition {a.conditionAtAssignment}
                  </p>
                  {a.acknowledgedAt && (
                    <p className="flex items-center gap-1 text-[12px] text-[var(--success)]">
                      <CheckCircle2 className="h-3 w-3" aria-hidden /> Receipt confirmed {formatDate(a.acknowledgedAt, { locale })}
                    </p>
                  )}
                </div>
                {a.isOverdue && <Badge tone="danger">Return overdue</Badge>}
                {!a.acknowledgedAt && (
                  <Button size="sm" onClick={() => setAcknowledging(a)}>
                    Confirm receipt
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Modal
        open={Boolean(acknowledging)}
        onClose={() => setAcknowledging(null)}
        title="Confirm you received this"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setAcknowledging(null)}>Cancel</Button>
            <Button loading={acknowledge.isPending} disabled={!name.trim()} onClick={() => acknowledging && acknowledge.mutate(acknowledging.id)}>I have it</Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-[13.5px] text-[var(--text-muted)]">
            {acknowledging?.asset?.name} ({acknowledging?.asset?.tag}), in {acknowledging?.conditionAtAssignment} condition.
          </p>
          <Input label="Your name" value={name} onChange={(e) => setName(e.target.value)} hint="Typed as your signature." />
        </div>
      </Modal>
    </>
  );
}
