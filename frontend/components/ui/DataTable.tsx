"use client";

import { type ReactNode } from "react";
import { ChevronLeft, ChevronRight, ChevronsUpDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./Button";
import { EmptyState, ErrorState, TableSkeleton } from "./States";

/**
 * The table.
 *
 * Server-driven: the caller passes the current page of rows plus the total,
 * and the component renders paging controls. It deliberately does NOT accept
 * "all rows and sort them here" — an HRMS table is an employee list or a
 * month of attendance, and pulling 4,000 rows into the browser to paginate
 * them client-side is how these products become unusable at scale.
 */

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Cell renderer. Falls back to the row's value at `key`. */
  render?: (row: T, index: number) => ReactNode;
  /** Sortable columns pass the field name the API accepts. */
  sortable?: boolean;
  align?: "left" | "center" | "right";
  width?: string;
  /** Hidden below the given breakpoint, so the table works on a phone. */
  hideBelow?: "sm" | "md" | "lg";
  className?: string;
}

export interface DataTableProps<T> {
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T, index: number) => string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;

  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  emptyIcon?: ReactNode;

  onRowClick?: (row: T) => void;

  sort?: string;
  onSortChange?: (sort: string) => void;

  page?: number;
  limit?: number;
  total?: number;
  onPageChange?: (page: number) => void;

  toolbar?: ReactNode;
  className?: string;
  dense?: boolean;
}

const HIDE_BELOW = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
  lg: "hidden lg:table-cell",
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  onRetry,
  emptyTitle = "Nothing here yet",
  emptyDescription,
  emptyAction,
  emptyIcon,
  onRowClick,
  sort,
  onSortChange,
  page = 1,
  limit = 25,
  total = 0,
  onPageChange,
  toolbar,
  className,
  dense,
}: DataTableProps<T>) {
  const totalPages = limit > 0 ? Math.max(1, Math.ceil(total / limit)) : 1;
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  const toggleSort = (key: string) => {
    if (!onSortChange) return;
    if (sort === key) onSortChange(`-${key}`);
    else if (sort === `-${key}`) onSortChange(key);
    else onSortChange(key);
  };

  return (
    <div className={cn("card overflow-hidden", className)}>
      {toolbar && <div className="border-b p-3">{toolbar}</div>}

      {loading ? (
        <TableSkeleton columns={Math.min(columns.length, 6)} />
      ) : error ? (
        <ErrorState description={error} onRetry={onRetry} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={emptyIcon}
          title={emptyTitle}
          description={emptyDescription}
          action={emptyAction}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b bg-[var(--surface-muted)]">
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    style={column.width ? { width: column.width } : undefined}
                    className={cn(
                      "px-4 py-2.5 text-left text-[12px] font-semibold uppercase tracking-wide text-[var(--text-muted)]",
                      column.align === "right" && "text-right",
                      column.align === "center" && "text-center",
                      column.hideBelow && HIDE_BELOW[column.hideBelow],
                      column.className
                    )}
                  >
                    {column.sortable && onSortChange ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className="inline-flex items-center gap-1 hover:text-[var(--text)]"
                      >
                        {column.header}
                        <ChevronsUpDown
                          className={cn(
                            "h-3.5 w-3.5",
                            (sort === column.key || sort === `-${column.key}`) && "text-brand-600"
                          )}
                          aria-hidden
                        />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={rowKey(row, index)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    "border-b border-[var(--border)] last:border-0",
                    onRowClick && "cursor-pointer hover:bg-[var(--surface-muted)]"
                  )}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn(
                        dense ? "px-4 py-2" : "px-4 py-3",
                        "text-[var(--text)]",
                        column.align === "right" && "text-right tabular",
                        column.align === "center" && "text-center",
                        column.hideBelow && HIDE_BELOW[column.hideBelow],
                        column.className
                      )}
                    >
                      {column.render
                        ? column.render(row, index)
                        : String((row as Record<string, unknown>)[column.key] ?? "—")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && rows.length > 0 && onPageChange && total > limit && (
        <div className="flex flex-col items-center justify-between gap-3 border-t px-4 py-3 sm:flex-row">
          <p className="text-[13px] text-[var(--text-muted)]">
            Showing <span className="tabular font-medium text-[var(--text)]">{from}</span>–
            <span className="tabular font-medium text-[var(--text)]">{to}</span> of{" "}
            <span className="tabular font-medium text-[var(--text)]">{total.toLocaleString()}</span>
          </p>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              icon={<ChevronLeft className="h-4 w-4" />}
            >
              Previous
            </Button>

            <span className="px-3 text-[13px] text-[var(--text-muted)]">
              Page <span className="tabular font-medium text-[var(--text)]">{page}</span> of{" "}
              <span className="tabular">{totalPages}</span>
            </span>

            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              iconRight={<ChevronRight className="h-4 w-4" />}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The search + filters bar that sits above most tables. */
export function TableToolbar({
  search,
  onSearchChange,
  placeholder = "Search…",
  filters,
  actions,
  activeFilterCount = 0,
  onClearFilters,
}: {
  search?: string;
  onSearchChange?: (value: string) => void;
  placeholder?: string;
  filters?: ReactNode;
  actions?: ReactNode;
  activeFilterCount?: number;
  onClearFilters?: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      {onSearchChange && (
        <div className="relative flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-subtle)]"
            aria-hidden
          />
          <input
            type="search"
            value={search || ""}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            className="input-base h-9 pl-9"
          />
        </div>
      )}

      {filters && <div className="flex flex-wrap items-center gap-2">{filters}</div>}

      {activeFilterCount > 0 && onClearFilters && (
        <Button variant="ghost" size="sm" onClick={onClearFilters} icon={<X className="h-3.5 w-3.5" />}>
          Clear {activeFilterCount === 1 ? "filter" : `${activeFilterCount} filters`}
        </Button>
      )}

      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A compact inline select for table filters. */
export function FilterSelect({
  value,
  onChange,
  options,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder: string;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={placeholder}
      className={cn(
        "input-base h-9 w-auto cursor-pointer py-0 pr-8 text-[13px]",
        value && "border-brand-400 bg-brand-50 text-brand-700",
        className
      )}
    >
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
