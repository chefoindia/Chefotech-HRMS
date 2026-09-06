"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { api } from "@/lib/api";
import { useReferenceData } from "@/lib/hooks";
import { Checkbox, FilterSelect } from "@/components/ui";

interface PickableEmployee {
  id: string;
  fullName: string;
  employeeCode: string;
  status?: string;
  employment?: { departmentId?: { id?: string; _id?: string; name?: string } | string | null; locationId?: { id?: string; _id?: string } | string | null };
}

export function useEmployeeOptions(enabled = true) {
  const { data, isLoading } = useQuery({
    queryKey: ["employees", "picker", "all"],
    queryFn: async () => {
      const { data } = await api.get<PickableEmployee[]>("/employees", { query: { limit: 500 } });
      return data;
    },
    enabled,
    staleTime: 60_000,
  });
  return { employees: data || [], isLoading };
}

/**
 * Choose many employees — for bulk generation and document requests.
 * Search and department filter narrow the list; "select all shown" picks
 * whatever is currently visible, so "everyone in Sales" is two clicks.
 */
export function EmployeeMultiPicker({ selected, onChange, maxHeight = "18rem" }: { selected: string[]; onChange: (ids: string[]) => void; maxHeight?: string }) {
  const { employees, isLoading } = useEmployeeOptions();
  const { departments } = useReferenceData();
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("");

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((e) => {
      if (department) {
        const dep = e.employment?.departmentId;
        const id = dep && typeof dep === "object" ? dep.id || dep._id : dep;
        if (String(id || "") !== department) return false;
      }
      if (!q) return true;
      return e.fullName.toLowerCase().includes(q) || e.employeeCode.toLowerCase().includes(q);
    });
  }, [employees, search, department]);

  const chosen = new Set(selected);
  const allVisibleChosen = visible.length > 0 && visible.every((e) => chosen.has(e.id));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-subtle)]" aria-hidden />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or code" className="input-base h-9 pl-8" aria-label="Search employees" />
        </div>
        <FilterSelect value={department} onChange={setDepartment} placeholder="All departments" options={departments.map((d) => ({ value: d.id, label: d.name }))} />
      </div>

      <div className="flex items-center justify-between text-[12.5px] text-[var(--text-muted)]">
        <span>
          {selected.length} selected · {visible.length} shown
        </span>
        <button
          type="button"
          className="font-medium text-brand-700 hover:underline"
          onClick={() => {
            if (allVisibleChosen) onChange(selected.filter((id) => !visible.some((e) => e.id === id)));
            else onChange([...new Set([...selected, ...visible.map((e) => e.id)])]);
          }}
        >
          {allVisibleChosen ? "Clear shown" : "Select all shown"}
        </button>
      </div>

      <div className="overflow-y-auto rounded-md border" style={{ maxHeight }}>
        {isLoading ? (
          <div className="skeleton m-2 h-24" />
        ) : visible.length === 0 ? (
          <p className="p-4 text-center text-[12.5px] text-[var(--text-muted)]">No employees match.</p>
        ) : (
          <ul className="divide-y">
            {visible.map((e) => (
              <li key={e.id} className="px-3 py-1.5">
                <Checkbox
                  label={
                    <span className="text-[13px]">
                      {e.fullName} <span className="text-[var(--text-subtle)]">({e.employeeCode})</span>
                    </span>
                  }
                  checked={chosen.has(e.id)}
                  onChange={(event) => onChange(event.target.checked ? [...selected, e.id] : selected.filter((id) => id !== e.id))}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
