"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Building2, FileText, Search, Settings, Users } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useDebounced } from "@/lib/hooks";
import { refLabel } from "@/lib/utils";
import { Card, EmptyState, PageHeader, PersonCell } from "@/components/ui";
import { SETTINGS_NAVIGATION, APP_NAVIGATION, filterNavigation, filterNavItems } from "@/components/shell/navigation";
import type { Employee } from "@/lib/types";

/**
 * Global search.
 *
 * Employees are the thing people look for ninety percent of the time, so they
 * come first and come from the server. Pages are matched locally against the
 * navigation tree the user can actually see — so a search never offers a
 * screen their role cannot open.
 */
export default function SearchPage() {
  const router = useRouter();
  const { can, canAny, hasFeature } = useSession();
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 300);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const { data: employees, isFetching } = useQuery({
    queryKey: ["search", "employees", debounced],
    queryFn: async () => {
      const { data } = await api.get<Employee[]>("/employees", {
        query: { q: debounced, limit: 8 },
      });
      return data;
    },
    enabled: debounced.length >= 2 && canAny("employee.view", "attendance.view_team"),
  });

  const { data: help } = useQuery({
    queryKey: ["search", "help", debounced],
    queryFn: async () => {
      const { data } = await api.post<{ matches: Array<{ intentId: string; answer: string; route: string | null }> }>(
        "/help/ask",
        { query: debounced }
      );
      return data.matches;
    },
    enabled: debounced.length >= 3,
  });

  const context = { can, canAny, hasFeature };
  const pages = [
    ...filterNavigation(APP_NAVIGATION, context).flatMap((section) =>
      section.items.flatMap((item) => [item, ...(item.children || [])])
    ),
    ...filterNavItems(SETTINGS_NAVIGATION, context),
  ].filter((item) => item.label.toLowerCase().includes(debounced.toLowerCase()) && debounced.length >= 2);

  const hasResults = Boolean(employees?.length || pages.length || help?.length);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Search" description="People, pages and help — all from one box." />

      <div className="relative mb-6">
        <Search
          className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--text-subtle)]"
          aria-hidden
        />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search employees, pages or ask a question"
          aria-label="Search"
          className="input-base h-12 pl-12 text-[15px]"
        />
      </div>

      {debounced.length < 2 ? (
        <Card>
          <EmptyState
            icon={<Search className="h-6 w-6" />}
            title="Start typing"
            description="Search by name, employee code or email — or ask a question like “how do I configure half day”."
          />
        </Card>
      ) : !hasResults && !isFetching ? (
        <Card>
          <EmptyState title={`Nothing found for “${debounced}”`} description="Try a different term." />
        </Card>
      ) : (
        <div className="space-y-5">
          {employees && employees.length > 0 && (
            <Card padded={false}>
              <p className="border-b px-4 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
                <Users className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />
                Employees
              </p>
              <ul className="divide-y">
                {employees.map((employee) => (
                  <li key={employee.id}>
                    <Link
                      href={`/app/employees/${employee.id}`}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--surface-muted)]"
                    >
                      <PersonCell
                        name={employee.fullName}
                        code={employee.employeeCode}
                        avatarUrl={employee.avatarUrl}
                        subtitle={refLabel(employee.employment.designationId, "")}
                      />
                      <ArrowRight
                        className="ml-auto h-4 w-4 shrink-0 text-[var(--text-subtle)]"
                        aria-hidden
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {pages.length > 0 && (
            <Card padded={false}>
              <p className="border-b px-4 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
                <Settings className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />
                Pages
              </p>
              <ul className="divide-y">
                {pages.slice(0, 8).map((page) => (
                  <li key={page.href}>
                    <Link
                      href={page.href}
                      className="flex items-center gap-3 px-4 py-2.5 text-[13.5px] hover:bg-[var(--surface-muted)]"
                    >
                      <Building2 className="h-4 w-4 shrink-0 text-[var(--text-subtle)]" aria-hidden />
                      <span className="flex-1">{page.label}</span>
                      <span className="font-mono text-[11.5px] text-[var(--text-subtle)]">
                        {page.href}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {help && help.length > 0 && (
            <Card padded={false}>
              <p className="border-b px-4 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--text-subtle)]">
                <FileText className="mr-1.5 inline h-3.5 w-3.5" aria-hidden />
                Help
              </p>
              <ul className="divide-y">
                {help.slice(0, 3).map((match) => (
                  <li key={match.intentId} className="px-4 py-3">
                    <p className="text-[13.5px] leading-relaxed text-[var(--text)]">{match.answer}</p>
                    {match.route && (
                      <button
                        type="button"
                        onClick={() => router.push(match.route!)}
                        className="mt-1.5 text-[12.5px] font-medium text-brand-600 hover:underline"
                      >
                        Take me there
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
