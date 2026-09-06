"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Laptop } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatDate, humanise } from "@/lib/format";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import type { AssetAssignment } from "@/lib/moduleTypes";

/** What this employee currently holds, from the asset register. */
export function EmployeeAssetsTab({ employeeId, locale }: { employeeId: string; locale: string }) {
  const { can } = useSession();
  const { data, isLoading } = useQuery({ queryKey: ["assets", "employee", employeeId], queryFn: async () => (await api.get<AssetAssignment[]>(`/assets/employee/${employeeId}`)).data, enabled: can("asset.view") });
  if (!can("asset.view")) return <Card><EmptyState title="Assets are not visible to you" description="You need the asset viewing permission." /></Card>;
  return (
    <Card>
      <CardHeader title="Assets in their care" description="Assigned through the asset register; returns are recorded there." action={can("asset.manage") && <Link href="/app/assets" className="text-[13px] font-medium text-brand-700 hover:underline">Open the register</Link>} />
      {isLoading ? (
        <div className="skeleton mt-4 h-24" />
      ) : !data?.length ? (
        <EmptyState icon={<Laptop className="h-5 w-5" />} title="Nothing assigned" description="Laptops, phones and cards assigned to this person appear here." className="mt-4" />
      ) : (
        <ul className="mt-4 divide-y">
          {data.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 py-3">
              <Laptop className="h-4.5 w-4.5 shrink-0 text-[var(--text-subtle)]" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-medium text-[var(--text)]">
                  {a.asset?.name} <span className="font-mono text-[12px] text-[var(--text-subtle)]">{a.asset?.tag}</span>
                </p>
                <p className="text-[12.5px] text-[var(--text-muted)]">
                  {humanise(a.asset?.category || "")} · since {formatDate(a.assignedOn, { locale })}
                  {a.expectedReturnOn ? ` · due ${formatDate(a.expectedReturnOn, { locale })}` : ""} · {a.acknowledgedAt ? `receipt confirmed ${formatDate(a.acknowledgedAt, { locale })}` : "receipt not confirmed"}
                </p>
              </div>
              {a.isOverdue && <Badge tone="danger">Overdue</Badge>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
