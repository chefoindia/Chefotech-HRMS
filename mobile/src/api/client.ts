import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * The API client.
 *
 * Mirrors the web client's envelope handling and refresh behaviour, with three
 * differences that matter on a phone:
 *
 *  1. Tokens live in the OS keychain (SecureStore), never in AsyncStorage.
 *     AsyncStorage is plain text on disk and readable on a rooted device — for
 *     a credential that unlocks someone's salary history that is not adequate.
 *  2. There are no cookies. The web client can fall back to a session cookie;
 *     here the bearer token is the only mechanism, so refresh has to be
 *     airtight rather than merely usual.
 *  3. Every request carries a timeout. A phone that has drifted onto a captive
 *     portal will otherwise hang forever rather than failing.
 */

const ACCESS_KEY = "chefotech.accessToken";
const REFRESH_KEY = "chefotech.refreshToken";
const BASE_KEY = "chefotech.apiBaseUrl";

/** Requests that have not answered by now are treated as failed. */
const TIMEOUT_MS = 20_000;

/**
 * Where the API lives.
 *
 * A physical phone cannot reach the laptop's "localhost", so in development we
 * derive the host from the Expo dev server the app was loaded from — which is
 * the same machine running the API. Without this, every developer's first run
 * fails with a network error that looks like a bug in the app.
 */
function defaultBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured) return configured.replace(/\/$/, "");

  const hostUri =
    Constants.expoConfig?.hostUri ??
    // Older manifests exposed the dev host under a different key.
    (Constants as unknown as { manifest?: { debuggerHost?: string } }).manifest?.debuggerHost;

  if (hostUri) {
    const host = String(hostUri).split(":")[0];
    return `http://${host}:5001`;
  }

  // Android's emulator maps the host machine to this address; iOS simulators
  // share the host's loopback.
  return Platform.OS === "android" ? "http://10.0.2.2:5001" : "http://localhost:5001";
}

let baseUrlOverride: string | null = null;

export async function getBaseUrl(): Promise<string> {
  if (baseUrlOverride) return baseUrlOverride;
  const stored = await SecureStore.getItemAsync(BASE_KEY).catch(() => null);
  baseUrlOverride = stored || defaultBaseUrl();
  return baseUrlOverride;
}

/** Lets a customer on a self-hosted deployment point the app at their server. */
export async function setBaseUrl(url: string | null): Promise<void> {
  baseUrlOverride = url ? url.replace(/\/$/, "") : defaultBaseUrl();
  if (url) await SecureStore.setItemAsync(BASE_KEY, baseUrlOverride);
  else await SecureStore.deleteItemAsync(BASE_KEY).catch(() => undefined);
}

export const API_PREFIX = "/api/v1";

// ── Token storage ───────────────────────────────────────────────────────────

export const tokens = {
  async get(): Promise<{ access: string | null; refresh: string | null }> {
    const [access, refresh] = await Promise.all([
      SecureStore.getItemAsync(ACCESS_KEY).catch(() => null),
      SecureStore.getItemAsync(REFRESH_KEY).catch(() => null),
    ]);
    return { access, refresh };
  },
  async set(access: string, refresh?: string | null): Promise<void> {
    await SecureStore.setItemAsync(ACCESS_KEY, access);
    if (refresh) await SecureStore.setItemAsync(REFRESH_KEY, refresh);
  },
  async clear(): Promise<void> {
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_KEY).catch(() => undefined),
      SecureStore.deleteItemAsync(REFRESH_KEY).catch(() => undefined),
    ]);
  },
};

// ── Errors ──────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  status: number;
  code: string;
  fieldErrors: Record<string, string>;
  /** True when the request never reached the server at all. */
  isOffline: boolean;

  constructor(
    message: string,
    options: {
      status?: number;
      code?: string;
      fieldErrors?: Record<string, string>;
      isOffline?: boolean;
    } = {}
  ) {
    super(message);
    this.name = "ApiError";
    this.status = options.status ?? 0;
    this.code = options.code ?? "UNKNOWN";
    this.fieldErrors = options.fieldErrors ?? {};
    this.isOffline = options.isOffline ?? false;
  }
}

// ── Sign-out listeners ──────────────────────────────────────────────────────

type SignOutListener = () => void;
const signOutListeners = new Set<SignOutListener>();

export function onSignedOut(listener: SignOutListener): () => void {
  signOutListeners.add(listener);
  return () => {
    signOutListeners.delete(listener);
  };
}

function notifySignedOut() {
  for (const listener of signOutListeners) listener();
}

// ── Refresh, deduplicated ───────────────────────────────────────────────────

/**
 * One refresh at a time.
 *
 * A phone waking from sleep fires every screen's query at once; without this
 * they would each notice the expired token and each POST a refresh. The
 * backend rotates refresh tokens and treats reuse as theft, so the second
 * request would invalidate the whole family and sign the user out — a bug that
 * only ever reproduces on a real device coming back from background.
 */
let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const { refresh } = await tokens.get();
    if (!refresh) return null;

    try {
      const base = await getBaseUrl();
      const response = await fetch(`${base}${API_PREFIX}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: refresh }),
      });

      if (!response.ok) return null;
      const body = await response.json();
      const access = body?.data?.accessToken;
      const nextRefresh = body?.data?.refreshToken;
      if (!access) return null;

      await tokens.set(access, nextRefresh);
      return access as string;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

// ── Request ─────────────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T;
  meta?: { page?: number; limit?: number; total?: number; totalPages?: number };
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Skip the refresh-and-retry dance; used by the refresh call itself. */
  skipAuth?: boolean;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
  const { method = "GET", body, query, skipAuth, signal } = options;
  const base = await getBaseUrl();

  let url = `${base}${path.startsWith("/api") ? "" : API_PREFIX}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const send = async (): Promise<Response> => {
    const { access } = skipAuth ? { access: null } : await tokens.get();

    // A timeout the caller did not ask for still has to respect a signal the
    // caller did pass — hence a controller that both can abort.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const onExternalAbort = () => controller.abort();
    signal?.addEventListener("abort", onExternalAbort);

    try {
      return await fetch(url, {
        method,
        headers: {
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(access ? { Authorization: `Bearer ${access}` } : {}),
          // The backend decides web vs mobile capture mode from this, so it
          // must clearly say mobile.
          "User-Agent": `ChefotechHRMS/1.0 (${Platform.OS})`,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onExternalAbort);
    }
  };

  let response: Response;
  try {
    response = await send();
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(
      "You appear to be offline. Check your connection and try again.",
      { isOffline: true, code: "OFFLINE" }
    );
  }

  // Expired access token: refresh once, then replay.
  if (response.status === 401 && !skipAuth) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      try {
        response = await send();
      } catch {
        throw new ApiError("You appear to be offline.", { isOffline: true, code: "OFFLINE" });
      }
    } else {
      await tokens.clear();
      notifySignedOut();
      throw new ApiError("Your session has ended. Please sign in again.", {
        status: 401,
        code: "SESSION_EXPIRED",
      });
    }
  }

  if (response.status === 204) return { data: undefined as T };

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = payload?.error ?? {};
    const fieldErrors: Record<string, string> = {};
    for (const detail of error.details ?? []) {
      if (detail?.field && detail?.message) fieldErrors[detail.field] = detail.message;
    }
    throw new ApiError(error.message || "Something went wrong. Please try again.", {
      status: response.status,
      code: error.code,
      fieldErrors,
    });
  }

  return { data: payload?.data as T, meta: payload?.meta };
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "POST", body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "PATCH", body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "DELETE" }),

  /** Absolute URL for a file the API serves, for download or sharing. */
  async fileUrl(path: string): Promise<string> {
    if (/^https?:\/\//.test(path)) return path;
    const base = await getBaseUrl();
    return `${base}${path.startsWith("/api") ? "" : API_PREFIX}${path}`;
  },
};
