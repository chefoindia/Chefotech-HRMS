"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Inbox, LifeBuoy, Plus, Star, UserX } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useListQuery, useListState } from "@/lib/hooks";
import { formatRelative, humanise } from "@/lib/format";
import { Badge, Button, DataTable, FilterSelect, NoAccessState, PageHeader, StatCard, StatusBadge, TableToolbar, Tabs, type Column } from "@/components/ui";
import { NewTicketDialog, TicketDrawer } from "@/components/modules/TicketDrawer";
import { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES, type Ticket, type TicketStats } from "@/lib/moduleTypes";

const PRIORITY_TONE: Record<string, "neutral" | "info" | "warning" | "danger"> = { low: "neutral", normal: "info", high: "warning", urgent: "danger" };

/** The help desk queue for agents. */
export default function TicketQueuePage() {
  const { can } = useSession();
  const [tab, setTab] = useState("assigned");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const state = useListState();

  const { data: stats } = useQuery({
    queryKey: ["tickets", "stats"],
    queryFn: async () => (await api.get<TicketStats>("/tickets/stats")).data,
    enabled: can("ticket.manage"),
    refetchInterval: 60_000,
  });

  const { items, total, limit, isLoading, error, refetch } = useListQuery<Ticket>("tickets", "/tickets", state, {
    limit: 30,
    extraQuery: { scope: tab === "overdue" ? "all" : tab, overdue: tab === "overdue" ? "true" : undefined, includeClosed: tab === "all" ? "true" : undefined },
    enabled: can("ticket.manage"),
  });

  if (!can("ticket.manage")) return <NoAccessState what="the help desk queue" />;

  const columns: Array<Column<Ticket>> = [
    { key: "number", header: "#", width: "4rem", render: (t) => <span className="font-mono text-[12px] text-[var(--text-subtle)]">{t.number}</span> },
    {
      key: "subject",
      header: "Ticket",
      render: (t) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-[var(--text)]">{t.subject}</p>
          <p className="truncate text-[12px] text-[var(--text-muted)]">
            {t.requester.name}
            {t.requester.department ? ` · ${t.requester.department}` : ""} · {t.category.toUpperCase()}
          </p>
        </div>
      ),
    },
    { key: "priority", header: "Priority", render: (t) => <Badge tone={PRIORITY_TONE[t.priority]}>{humanise(t.priority)}</Badge> },
    { key: "status", header: "Status", render: (t) => <StatusBadge status={t.status === "in_progress" ? "processing" : t.status === "waiting_on_requester" ? "pending" : t.status} label={humanise(t.status)} /> },
    { key: "assignee", header: "Assignee", hideBelow: "md", render: (t) => t.assignee?.name || <span className="text-[var(--text-subtle)]">Unassigned</span> },
    {
      key: "lastActivityAt",
      header: "Activity",
      hideBelow: "md",
      render: (t) => (
        <span className={t.isOverdue ? "text-[var(--danger)]" : ""}>
          {t.isOverdue ? "Overdue · " : ""}
          {formatRelative(t.lastActivityAt)}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Help desk"
        description="Every ticket raised by employees, who has it, and what is overdue."
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            Raise on behalf
          </Button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Assigned to me" value={stats?.mine ?? "—"} icon={<Inbox className="h-4 w-4" />} onClick={() => setTab("assigned")} />
        <StatCard label="Unassigned" value={stats?.unassigned ?? "—"} icon={<UserX className="h-4 w-4" />} tone={stats?.unassigned ? "warning" : "default"} onClick={() => setTab("unassigned")} />
        <StatCard label="Overdue" value={stats?.overdue ?? "—"} icon={<AlertTriangle className="h-4 w-4" />} tone={stats?.overdue ? "danger" : "default"} onClick={() => setTab("overdue")} />
        <StatCard label="Resolved this week" value={stats?.resolvedThisWeek ?? "—"} icon={<LifeBuoy className="h-4 w-4" />} tone="success" />
        <StatCard label="Average rating" value={stats?.averageRating ? `${stats.averageRating} / 5` : "—"} hint={stats?.ratings ? `${stats.ratings} rating${stats.ratings === 1 ? "" : "s"}` : "No ratings yet"} icon={<Star className="h-4 w-4" />} />
      </div>

      <Tabs
        items={[
          { key: "assigned", label: "Mine" },
          { key: "unassigned", label: "Unassigned" },
          { key: "overdue", label: "Overdue" },
          { key: "all", label: "All" },
        ]}
        active={tab}
        onChange={(key) => {
          setTab(key);
          state.setPage(1);
        }}
        className="mb-4"
      />

      <DataTable
        columns={columns}
        rows={items}
        rowKey={(t) => t.id}
        loading={isLoading}
        error={error ? (error as Error).message : null}
        onRetry={refetch}
        onRowClick={(t) => setOpenId(t.id)}
        page={state.page}
        limit={limit}
        total={total}
        onPageChange={state.setPage}
        emptyIcon={<LifeBuoy className="h-6 w-6" />}
        emptyTitle="Nothing here"
        emptyDescription={tab === "assigned" ? "No tickets are assigned to you." : "No tickets match."}
        toolbar={
          <TableToolbar
            search={state.search}
            onSearchChange={state.setSearch}
            placeholder="Search subject or #number"
            filters={
              <>
                <FilterSelect value={state.filters.status || ""} onChange={(v) => state.setFilter("status", v)} placeholder="Any status" options={TICKET_STATUSES.map((s) => ({ value: s, label: humanise(s) }))} />
                <FilterSelect value={state.filters.priority || ""} onChange={(v) => state.setFilter("priority", v)} placeholder="Any priority" options={TICKET_PRIORITIES.map((p) => ({ value: p, label: humanise(p) }))} />
                <FilterSelect value={state.filters.category || ""} onChange={(v) => state.setFilter("category", v)} placeholder="Any category" options={TICKET_CATEGORIES.map((c) => ({ value: c, label: c.toUpperCase() }))} />
              </>
            }
            activeFilterCount={state.activeFilterCount}
            onClearFilters={state.clearFilters}
          />
        }
      />

      {openId && <TicketDrawer ticketId={openId} onClose={() => setOpenId(null)} />}
      {creating && (
        <NewTicketDialog
          onClose={() => setCreating(false)}
          onDone={(ticket) => {
            setCreating(false);
            setOpenId(ticket.id);
          }}
        />
      )}
    </>
  );
}
