// src/lib/resource.js
//
// A small stale-while-revalidate cache for screen data.
//
// The problem this solves is the app's "buffering": every tab mount fired its
// own fetch and rendered a spinner until it landed, so moving between tabs
// showed a loading state each time even for data fetched seconds earlier.
// Here, a screen paints from cache immediately and refreshes behind — the
// spinner only ever appears on genuinely cold data.
//
// Deliberately not React Query: this needs ~80 lines and one dependency-free
// module, and the app's payloads are small and per-user. Adding a data layer
// with its own devtools and cache semantics would grow the bundle we are
// trying to shrink.

import { useCallback, useEffect, useRef, useState } from "react";

const store = new Map(); // key -> { data, at }
const inflight = new Map(); // key -> Promise, so N mounts share one request

const DEFAULT_TTL = 60_000; // treat data older than this as worth refreshing

export function readCache(key) {
  return store.get(key);
}

export function writeCache(key, data) {
  store.set(key, { data, at: Date.now() });
}

/** Drop cached entries. Call on logout so the next user never sees stale data. */
export function clearCache(prefix) {
  if (!prefix) {
    store.clear();
    inflight.clear();
    return;
  }
  for (const k of [...store.keys()]) {
    if (k.startsWith(prefix)) store.delete(k);
  }
}

/**
 * @param key      stable cache key, or null to skip fetching entirely
 * @param fetcher  () => Promise<data>
 * @param options  { ttl, enabled }
 */
export function useResource(key, fetcher, options = {}) {
  const { ttl = DEFAULT_TTL, enabled = true } = options;

  const cached = key ? store.get(key) : null;
  const [data, setData] = useState(cached ? cached.data : null);
  // Only a cold read is "loading" — a warm one paints instantly.
  const [loading, setLoading] = useState(!cached && enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (isManual) => {
      if (!key || !enabled) return;

      if (isManual) setRefreshing(true);

      try {
        // Share a single in-flight request across every caller of this key.
        let p = inflight.get(key);
        if (!p) {
          p = Promise.resolve().then(() => fetcherRef.current());
          inflight.set(key, p);
          p.finally(() => {
            if (inflight.get(key) === p) inflight.delete(key);
          });
        }

        const result = await p;
        writeCache(key, result);
        if (mounted.current) {
          setData(result);
          setError(null);
        }
      } catch (e) {
        if (mounted.current) setError(e);
      } finally {
        if (mounted.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [key, enabled],
  );

  useEffect(() => {
    if (!key || !enabled) return;
    const hit = store.get(key);
    if (hit) {
      setData(hit.data);
      setLoading(false);
      // Warm but stale — revalidate quietly behind the painted screen.
      if (Date.now() - hit.at > ttl) run(false);
    } else {
      setLoading(true);
      run(false);
    }
  }, [key, enabled, ttl, run]);

  const refresh = useCallback(() => run(true), [run]);

  return { data, loading, refreshing, error, refresh };
}

export default useResource;
