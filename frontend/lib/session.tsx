"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, tokens, onSignedOut } from "./api";
import { applyBranding, resetBranding } from "./theme";
import type { Session } from "./types";

/**
 * The session.
 *
 * Holds the signed-in user, their organization, and their permission list.
 * Two things live here rather than being scattered:
 *
 *   - `can()`, the single place the UI asks whether something is allowed. It
 *     hides what a user cannot do; the API is what actually enforces it. Both
 *     read the same permission strings, so they never drift.
 *   - branding, applied to CSS variables as soon as the organization is known.
 */

interface SessionContextValue {
  session: Session | null;
  loading: boolean;
  error: string | null;
  can: (...permissions: string[]) => boolean;
  canAny: (...permissions: string[]) => boolean;
  hasFeature: (feature: string) => boolean;
  refresh: () => Promise<void>;
  signIn: (email: string, password: string, organizationId?: string) => Promise<SignInResult>;
  /** Second step of sign-in when the account has two-factor on. */
  completeMfa: (mfaToken: string, code: string, organizationId?: string) => Promise<SignInResult>;
  signOut: () => Promise<void>;
  switchOrganization: (organizationId: string) => Promise<void>;
}

export interface SignInResult {
  mode: "session" | "select_organization" | "platform" | "mfa_required";
  redirectTo?: string;
  organizations?: Array<{ id: string; name: string; slug: string }>;
  /** Present when mode is "mfa_required": proves the password step, expires in minutes. */
  mfaToken?: string;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tokens.get()) {
      setSession(null);
      setLoading(false);
      return;
    }

    try {
      const { data } = await api.get<Session>("/auth/me");
      setSession(data);
      setError(null);
      applyBranding(data.organization?.branding);
    } catch (err) {
      if (err instanceof ApiError && err.isAuthError) {
        tokens.clear();
        setSession(null);
      } else {
        setError(err instanceof Error ? err.message : "Could not load your session.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // A hard 401 anywhere in the app clears the session rather than leaving a
  // shell rendered against data the user can no longer fetch.
  useEffect(() => {
    return onSignedOut(() => {
      setSession(null);
      resetBranding();
      setLoading(false);
    });
  }, []);

  // A second tab signing out should sign this one out too.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === "chefotech.access_token" && !event.newValue) {
        setSession(null);
        resetBranding();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const adopt = useCallback(
    async (data: any): Promise<SignInResult> => {
      if (data.mode === "mfa_required") {
        return { mode: "mfa_required", mfaToken: data.mfaToken };
      }

      tokens.set(data.accessToken, data.refreshToken);

      if (data.mode === "select_organization") {
        return { mode: "select_organization", organizations: data.organizations };
      }

      if (data.mode === "platform") {
        await load();
        return { mode: "platform", redirectTo: data.redirectTo || "/platform" };
      }

      setSession({
        user: data.user,
        organization: data.organization,
        permissions: data.permissions,
        roles: data.roles,
        employeeId: data.employeeId,
        isPlatformUser: false,
        passwordExpired: Boolean(data.passwordExpired),
        mfaSetupRequired: Boolean(data.mfaSetupRequired),
        mfaEnabled: Boolean(data.mfaEnabled),
      });
      applyBranding(data.organization?.branding);

      return { mode: "session", redirectTo: data.redirectTo || "/app" };
    },
    [load]
  );

  const signIn = useCallback(
    async (email: string, password: string, organizationId?: string): Promise<SignInResult> => {
      const { data } = await api.post<any>("/auth/login", { email, password, organizationId }, { raw: true });
      return adopt(data);
    },
    [adopt]
  );

  const completeMfa = useCallback(
    async (mfaToken: string, code: string, organizationId?: string): Promise<SignInResult> => {
      const { data } = await api.post<any>("/auth/mfa/verify", { mfaToken, token: code, organizationId }, { raw: true });
      return adopt(data);
    },
    [adopt]
  );

  const signOut = useCallback(async () => {
    await api.post("/auth/logout").catch(() => {});
    tokens.clear();
    setSession(null);
    resetBranding();
    router.push("/login");
  }, [router]);

  const switchOrganization = useCallback(
    async (organizationId: string) => {
      const { data } = await api.post<any>("/auth/switch-organization", { organizationId });
      tokens.set(data.accessToken, data.refreshToken);
      await load();
      router.push(data.redirectTo || "/app");
    },
    [load, router]
  );

  const permissionSet = useMemo(
    () => new Set(session?.permissions || []),
    [session?.permissions]
  );

  const can = useCallback(
    (...permissions: string[]) => permissions.every((p) => permissionSet.has(p)),
    [permissionSet]
  );

  const canAny = useCallback(
    (...permissions: string[]) => permissions.some((p) => permissionSet.has(p)),
    [permissionSet]
  );

  const hasFeature = useCallback(
    (feature: string) => Boolean(session?.organization?.features?.includes(feature)),
    [session?.organization?.features]
  );

  const value = useMemo(
    () => ({
      session,
      loading,
      error,
      can,
      canAny,
      hasFeature,
      refresh: load,
      signIn,
      completeMfa,
      signOut,
      switchOrganization,
    }),
    [session, loading, error, can, canAny, hasFeature, load, signIn, completeMfa, signOut, switchOrganization]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside a SessionProvider");
  return context;
}

/** Convenience for the common "is this allowed" check inside a component. */
export function usePermission(...permissions: string[]) {
  const { can } = useSession();
  return can(...permissions);
}
