/**
 * The API client.
 *
 * One place that knows how to talk to the backend: base URL, the response
 * envelope, error shape, and token handling.
 *
 * On tokens: the access token is held in memory and mirrored into
 * localStorage so a page reload does not sign the user out. It is sent as a
 * Bearer header, AND the request sets credentials:"include" so the httpOnly
 * cookie works too. That duplication is deliberate — Chrome refuses
 * cross-site cookies between localhost:3000 and localhost:5001 without
 * SameSite=None;Secure, which is impossible over plain http in development.
 * Remove either half and one of the two deployment shapes breaks.
 */

const BASE_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001").replace(/\/+$/, "");
const API_PREFIX = "/api/v1";

const ACCESS_TOKEN_KEY = "chefotech.access_token";
const REFRESH_TOKEN_KEY = "chefotech.refresh_token";

export interface ApiErrorShape {
  code: string;
  message: string;
  details?: Array<{ field?: string; path?: string; message: string }> | Record<string, unknown>;
}

export class ApiError extends Error {
  code: string;
  status: number;
  details?: ApiErrorShape["details"];
  requestId?: string;

  constructor(error: ApiErrorShape, status: number, requestId?: string) {
    super(error.message);
    this.name = "ApiError";
    this.code = error.code;
    this.status = status;
    this.details = error.details;
    this.requestId = requestId;
  }

  /** Field-level messages, keyed by field, for form rendering. */
  get fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    const out: Record<string, string> = {};
    for (const detail of this.details) {
      const key = detail.field || detail.path;
      if (key && !out[key]) out[key] = detail.message;
    }
    return out;
  }

  get isAuthError() {
    return this.status === 401;
  }

  get isPermissionError() {
    return this.code === "PERMISSION_DENIED" || this.code === "FORBIDDEN";
  }

  get isPlanError() {
    return this.code === "FEATURE_NOT_AVAILABLE" || this.code === "PLAN_LIMIT_REACHED";
  }
}

// ── Token storage ────────────────────────────────────────────────────────────

let accessToken: string | null = null;
let refreshToken: string | null = null;

export const tokens = {
  set(access: string | null, refresh?: string | null) {
    accessToken = access;
    if (refresh !== undefined) refreshToken = refresh;

    if (typeof window === "undefined") return;
    if (access) window.localStorage.setItem(ACCESS_TOKEN_KEY, access);
    else window.localStorage.removeItem(ACCESS_TOKEN_KEY);

    if (refresh) window.localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
    else if (refresh === null) window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  },

  get() {
    if (accessToken) return accessToken;
    if (typeof window === "undefined") return null;
    accessToken = window.localStorage.getItem(ACCESS_TOKEN_KEY);
    return accessToken;
  },

  getRefresh() {
    if (refreshToken) return refreshToken;
    if (typeof window === "undefined") return null;
    refreshToken = window.localStorage.getItem(REFRESH_TOKEN_KEY);
    return refreshToken;
  },

  clear() {
    accessToken = null;
    refreshToken = null;
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(ACCESS_TOKEN_KEY);
    window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  },
};

// ── Refresh, with a single in-flight attempt ────────────────────────────────

let refreshPromise: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  // Several requests failing at once must trigger ONE refresh, not five.
  // Presenting the same refresh token twice is treated by the API as reuse and
  // revokes the whole session family.
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const response = await fetch(`${BASE_URL}${API_PREFIX}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ refreshToken: tokens.getRefresh() || undefined }),
      });

      if (!response.ok) return false;

      const payload = await response.json();
      tokens.set(payload.data.accessToken, payload.data.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      // Release the lock on the next tick so concurrent callers all see the
      // same result before a new attempt can start.
      setTimeout(() => {
        refreshPromise = null;
      }, 0);
    }
  })();

  return refreshPromise;
}

type Listener = () => void;
const signOutListeners = new Set<Listener>();

/** The session provider subscribes so a hard 401 clears the UI. */
export function onSignedOut(listener: Listener): () => void {
  signOutListeners.add(listener);
  return () => {
    signOutListeners.delete(listener);
  };
}

function announceSignOut() {
  tokens.clear();
  for (const listener of signOutListeners) listener();
}

// ── Request ─────────────────────────────────────────────────────────────────

export interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Skip the refresh-and-retry dance (used by auth endpoints themselves). */
  raw?: boolean;
  /** Return the Response instead of parsing, for file downloads. */
  asResponse?: boolean;
}

export interface ApiResponse<T> {
  data: T;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
    hasNext?: boolean;
    hasPrev?: boolean;
    [key: string]: unknown;
  };
}

function buildUrl(path: string, query?: RequestOptions["query"]) {
  const url = new URL(`${BASE_URL}${API_PREFIX}${path.startsWith("/") ? path : `/${path}`}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
  const { method = "GET", body, query, headers = {}, signal, raw, asResponse } = options;

  const send = async (): Promise<Response> => {
    const token = tokens.get();
    const isFormData = typeof FormData !== "undefined" && body instanceof FormData;

    return fetch(buildUrl(path, query), {
      method,
      credentials: "include",
      signal,
      headers: {
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : isFormData ? (body as FormData) : JSON.stringify(body),
    });
  };

  let response = await send();

  // One transparent refresh-and-retry on an expired access token.
  if (response.status === 401 && !raw) {
    const payload = await response.clone().json().catch(() => null);
    const code = payload?.error?.code;

    if (code === "TOKEN_EXPIRED" || code === "UNAUTHENTICATED") {
      const refreshed = await refreshSession();
      if (refreshed) {
        response = await send();
      } else {
        announceSignOut();
      }
    }
  }

  if (asResponse) {
    if (!response.ok) await throwFromResponse(response);
    return { data: response as unknown as T };
  }

  if (response.status === 204) return { data: null as T };

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const error = payload?.error || { code: "INTERNAL_ERROR", message: "Something went wrong." };
    if (response.status === 401) announceSignOut();
    throw new ApiError(error, response.status, payload?.requestId);
  }

  return { data: payload?.data as T, meta: payload?.meta };
}

async function throwFromResponse(response: Response): Promise<never> {
  const payload = await response.json().catch(() => null);
  throw new ApiError(
    payload?.error || { code: "INTERNAL_ERROR", message: "Something went wrong." },
    response.status,
    payload?.requestId
  );
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "GET" }),

  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "POST", body }),

  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "PATCH", body }),

  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "PUT", body }),

  delete: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "DELETE", body }),

  /** Multipart upload. Do not set Content-Type — the browser adds the boundary. */
  upload: <T>(path: string, formData: FormData, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "POST", body: formData }),

  /**
   * Download a file the API generates (reports, payslips, templates).
   * Goes through the same auth path, so private documents stay private.
   */
  async download(path: string, query?: RequestOptions["query"], fallbackName = "download") {
    const { data: response } = await request<Response>(path, { query, asResponse: true });

    const disposition = response.headers.get("content-disposition") || "";
    const match = /filename="?([^"]+)"?/.exec(disposition);
    const fileName = match ? decodeURIComponent(match[1]) : fallbackName;

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);

    return fileName;
  },

  /** Absolute URL for a file served by the authenticated proxy. */
  fileUrl(path: string) {
    return `${BASE_URL}${path.startsWith("/api") ? path : `${API_PREFIX}${path}`}`;
  },
};

export { BASE_URL, API_PREFIX };
