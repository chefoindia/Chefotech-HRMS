"use client";

import { useQuery } from "@tanstack/react-query";
import { Mail, Phone, Users } from "lucide-react";
import { api } from "@/lib/api";
import { useListState, useReferenceData } from "@/lib/hooks";
import { useDebounced } from "@/lib/hooks";
import { Avatar, Button, Card, EmptyState, FilterSelect, PageHeader, TableToolbar } from "@/components/ui";
import type { DirectoryEntry } from "@/lib/lifecycleTypes";

/** Who is who: searchable, with a way to reach them. Nothing sensitive. */
export default function DirectoryPage() {
  const state = useListState();
  const search = useDebounced(state.search);
  const { departments, locations } = useReferenceData();

  const { data, isLoading } = useQuery({
    queryKey: ["directory", search, state.filters, state.page],
    queryFn: async () => {
      const response = await api.get<DirectoryEntry[]>("/employees/directory", { query: { q: search || undefined, limit: 60, page: state.page, ...state.filters } });
      return { items: response.data, total: response.meta?.total || 0 };
    },
    placeholderData: (previous) => previous,
  });

  return (
    <>
      <PageHeader title="People" description="Find a colleague, their team, and how to reach them." />
      <div className="mb-4">
        <TableToolbar
          search={state.search}
          onSearchChange={state.setSearch}
          placeholder="Search by name, code or skill"
          filters={
            <>
              <FilterSelect value={state.filters.departmentId || ""} onChange={(v) => state.setFilter("departmentId", v)} placeholder="All departments" options={departments.map((d) => ({ value: d.id, label: d.name }))} />
              <FilterSelect value={state.filters.locationId || ""} onChange={(v) => state.setFilter("locationId", v)} placeholder="All locations" options={locations.map((d) => ({ value: d.id, label: d.name }))} />
            </>
          }
          activeFilterCount={state.activeFilterCount}
          onClearFilters={state.clearFilters}
        />
      </div>
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton h-24" />)}</div>
      ) : !data?.items.length ? (
        <Card><EmptyState icon={<Users className="h-6 w-6" />} title="Nobody matches" description="Try another name, or clear the filters." /></Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.items.map((p) => (
              <Card key={p.id} className="flex gap-3">
                <Avatar src={p.avatarUrl} name={p.name} size="lg" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-[var(--text)]">{p.name}</p>
                  <p className="truncate text-[12.5px] text-[var(--text-muted)]">
                    {p.designation || "—"}
                    {p.department ? ` · ${p.department}` : ""}
                  </p>
                  <p className="truncate text-[12px] text-[var(--text-subtle)]">
                    {p.location || ""}
                    {p.manager ? `${p.location ? " · " : ""}reports to ${p.manager.name}` : ""}
                  </p>
                  <div className="mt-2 flex gap-1.5">
                    {p.workEmail && (
                      <a href={`mailto:${p.workEmail}`} className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[12px] hover:bg-[var(--surface-muted)]" title={p.workEmail}>
                        <Mail className="h-3 w-3" aria-hidden /> Email
                      </a>
                    )}
                    {p.phone && (
                      <a href={`tel:${p.phone}`} className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[12px] hover:bg-[var(--surface-muted)]" title={p.phone}>
                        <Phone className="h-3 w-3" aria-hidden /> Call
                      </a>
                    )}
                  </div>
                  {p.skills.length > 0 && <p className="mt-1.5 truncate text-[11.5px] text-[var(--text-subtle)]">{p.skills.join(" · ")}</p>}
                </div>
              </Card>
            ))}
          </div>
          {data.total > 60 && (
            <div className="mt-4 flex items-center justify-between text-[12.5px] text-[var(--text-muted)]">
              <span>Page {state.page} of {Math.ceil(data.total / 60)}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={state.page <= 1} onClick={() => state.setPage(state.page - 1)}>Previous</Button>
                <Button variant="outline" size="sm" disabled={state.page * 60 >= data.total} onClick={() => state.setPage(state.page + 1)}>Next</Button>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
