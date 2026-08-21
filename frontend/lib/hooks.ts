"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { api } from "./api";
import type { Paged } from "./types";

/**
 * Shared data hooks.
 *
 * `useListQuery` bundles the four things every list screen needs — paging,
 * search debouncing, filters and the API envelope — so a new list page is a
 * column definition rather than fifty lines of state.
 */

export interface ListState {
  page: number;
  setPage: (page: number) => void;
  search: string;
  setSearch: (value: string) => void;
  sort: string;
  setSort: (value: string) => void;
  filters: Record<string, string>;
  setFilter: (key: string, value: string) => void;
  clearFilters: () => void;
  activeFilterCount: number;
}

export function useListState(initial: { sort?: string; filters?: Record<string, string> } = {}): ListState {
  const [page, setPage] = useState(1);
  const [search, setSearchValue] = useState("");
  const [sort, setSort] = useState(initial.sort || "");
  const [filters, setFilters] = useState<Record<string, string>>(initial.filters || {});

  // Any change other than the page itself should return to page one, or the
  // user searches and lands on an empty page 4.
  const setSearch = useCallback((value: string) => {
    setSearchValue(value);
    setPage(1);
  }, []);

  const setFilter = useCallback((key: string, value: string) => {
    setFilters((current) => {
      const next = { ...current };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
    setPage(1);
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({});
    setSearchValue("");
    setPage(1);
  }, []);

  return {
    page,
    setPage,
    search,
    setSearch,
    sort,
    setSort,
    filters,
    setFilter,
    clearFilters,
    activeFilterCount: Object.keys(filters).length + (search ? 1 : 0),
  };
}

/** Debounce a value, so typing in a search box does not fire a request per key. */
export function useDebounced<T>(value: T, delay = 350) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

export function useListQuery<T>(
  key: string,
  path: string,
  state: ListState,
  options: {
    limit?: number;
    extraQuery?: Record<string, string | number | undefined>;
    enabled?: boolean;
  } = {}
) {
  const { limit = 25, extraQuery = {}, enabled = true } = options;
  const debouncedSearch = useDebounced(state.search);

  const query = useMemo(
    () => ({
      page: state.page,
      limit,
      q: debouncedSearch || undefined,
      sort: state.sort || undefined,
      ...state.filters,
      ...extraQuery,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.page, limit, debouncedSearch, state.sort, state.filters, JSON.stringify(extraQuery)]
  );

  const result = useQuery({
    queryKey: [key, query],
    queryFn: async () => {
      const response = await api.get<T[]>(path, { query });
      return {
        items: response.data || [],
        page: response.meta?.page || 1,
        limit: response.meta?.limit || limit,
        total: response.meta?.total || 0,
        totalPages: response.meta?.totalPages || 1,
      } as Paged<T>;
    },
    enabled,
    placeholderData: (previous) => previous,
  });

  return {
    ...result,
    items: result.data?.items || [],
    total: result.data?.total || 0,
    limit: result.data?.limit || limit,
  };
}

/** Reference data used by pickers all over the product. */
export function useReferenceData(enabled = true) {
  const departments = useQuery({
    queryKey: ["ref", "departments"],
    queryFn: async () => {
      const { data } = await api.get<Array<{ id: string; name: string; code: string }>>("/departments", {
        query: { limit: 200, isActive: "true" },
      });
      return data;
    },
    enabled,
    staleTime: 5 * 60_000,
  });

  const designations = useQuery({
    queryKey: ["ref", "designations"],
    queryFn: async () => {
      const { data } = await api.get<Array<{ id: string; name: string; code: string }>>("/designations", {
        query: { limit: 200, isActive: "true" },
      });
      return data;
    },
    enabled,
    staleTime: 5 * 60_000,
  });

  const locations = useQuery({
    queryKey: ["ref", "locations"],
    queryFn: async () => {
      const { data } = await api.get<Array<{ id: string; name: string; code: string }>>("/locations", {
        query: { limit: 200, isActive: "true" },
      });
      return data;
    },
    enabled,
    staleTime: 5 * 60_000,
  });

  const shifts = useQuery({
    queryKey: ["ref", "shifts"],
    queryFn: async () => {
      const { data } = await api.get<Array<{ id: string; name: string; code: string; startTime: string; endTime: string }>>(
        "/shifts",
        { query: { limit: 100 } }
      );
      return data;
    },
    enabled,
    staleTime: 5 * 60_000,
  });

  return {
    departments: departments.data || [],
    designations: designations.data || [],
    locations: locations.data || [],
    shifts: shifts.data || [],
    loading:
      departments.isLoading || designations.isLoading || locations.isLoading || shifts.isLoading,
  };
}

/** Turn reference rows into <Select> options. */
export function toOptions<T extends { id: string; name: string }>(rows: T[]) {
  return rows.map((row) => ({ value: row.id, label: row.name }));
}
