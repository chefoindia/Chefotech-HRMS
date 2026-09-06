"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LifeBuoy, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { formatRelative, humanise } from "@/lib/format";
import { Badge, Button, Card, EmptyState, PageHeader, StatusBadge, Tabs } from "@/components/ui";
import { NewTicketDialog, TicketDrawer } from "@/components/modules/TicketDrawer";
import type { Ticket } from "@/lib/moduleTypes";

/** My help desk tickets. */
export default function MyTicketsPage() {
  const { can } = useSession();
  const [tab, setTab] = useState("open");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["tickets", "mine"],
    queryFn: async () => (await api.get<Ticket[]>("/tickets", { query: { scope: "mine", limit: 100 } })).data,
    enabled: can("ticket.view_own") || can("ticket.manage"),
  });

  const rows = data || [];
  const open = rows.filter((t) => t.status !== "closed");
  const closed = rows.filter((t) => t.status === "closed");
  const shown = tab === "open" ? open : closed;

  return (
    <>
      <PageHeader
        title="Help desk"
        description="IT, HR, payroll or facilities — raise a ticket and follow it to resolution."
        actions={
          can("ticket.create") && (
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
              Raise a ticket
            </Button>
          )
        }
      />

      <Tabs items={[{ key: "open", label: "Open", count: open.length }, { key: "closed", label: "Closed", count: closed.length }]} active={tab} onChange={setTab} className="mb-5" />

      {isLoading ? (
        <div className="skeleton h-32" />
      ) : !shown.length ? (
        <Card>
          <EmptyState icon={<LifeBuoy className="h-6 w-6" />} title={tab === "open" ? "No open tickets" : "No closed tickets"} description="Something broken, missing or unclear? Raise a ticket and the right team picks it up." action={can("ticket.create") ? <Button onClick={() => setCreating(true)}>Raise a ticket</Button> : undefined} />
        </Card>
      ) : (
        <Card padded={false}>
          <ul className="divide-y">
            {shown.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => setOpenId(t.id)} className="flex w-full flex-wrap items-center gap-3 px-5 py-3.5 text-left hover:bg-[var(--surface-muted)]">
                  <span className="w-14 shrink-0 font-mono text-[12px] text-[var(--text-subtle)]">#{t.number}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium text-[var(--text)]">{t.subject}</p>
                    <p className="truncate text-[12.5px] text-[var(--text-muted)]">
                      {t.category.toUpperCase()} · {humanise(t.priority)} · {t.assignee ? `with ${t.assignee.name}` : "not yet assigned"} · updated {formatRelative(t.lastActivityAt)}
                      {t.commentCount ? ` · ${t.commentCount} repl${t.commentCount === 1 ? "y" : "ies"}` : ""}
                    </p>
                  </div>
                  {t.status === "waiting_on_requester" && <Badge tone="warning">Your reply needed</Badge>}
                  <StatusBadge status={t.status === "in_progress" ? "processing" : t.status === "waiting_on_requester" ? "pending" : t.status} label={humanise(t.status)} />
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {creating && (
        <NewTicketDialog
          onClose={() => setCreating(false)}
          onDone={(ticket) => {
            setCreating(false);
            setOpenId(ticket.id);
          }}
        />
      )}
      {openId && <TicketDrawer ticketId={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}
