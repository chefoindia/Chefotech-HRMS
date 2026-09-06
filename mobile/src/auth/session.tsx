import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import * as SecureStore from "expo-secure-store";
import { api, ApiError, onSignedOut, tokens } from "../api/client";
import { registerForPush, unregisterPush } from "../notifications/push";

/**
 * Who is signed in, and what they may do.
 *
 * Permissions come from the server on every session load rather than being
 * inferred from a role name on the device. A phone that has been offline for a
 * week must not still believe it can approve leave because it remembers being
 * a manager — the next successful call re-reads the truth.
 */

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  status: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  branding?: { logoUrl?: string | null; primaryColor?: string | null };
}

export interface Session {
  user: SessionUser;
  organization: Organization | null;
  permissions: string[];
  employeeId: string | null;
  roles?: { id: string; key: string; name: string }[];
}

interface SessionValue {
  session: Session | null;
  loading: boolean;
  /** True once the first load has settled, so the router can stop waiting. */
  ready: boolean;
  /** Resolves to a challenge when the account has two-factor on; otherwise the session is set. */
  signIn: (email: string, password: string) => Promise<SignInOutcome>;
  /** Second step: the code from the authenticator app or a recovery code. */
  completeMfa: (mfaToken: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (...permissions: string[]) => boolean;
}

export type SignInOutcome = { mfaRequired: true; mfaToken: string } | { mfaRequired: false };

const SessionContext = createContext<SessionValue | null>(null);

/** Remembered so the intro carousel is shown once, not on every launch. */
const SEEN_INTRO_KEY = "chefotech.seenIntro";

export async function hasSeenIntro(): Promise<boolean> {
  return (await SecureStore.getItemAsync(SEEN_INTRO_KEY).catch(() => null)) === "yes";
}
export async function markIntroSeen(): Promise<void> {
  await SecureStore.setItemAsync(SEEN_INTRO_KEY, "yes").catch(() => undefined);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    const { access } = await tokens.get();
    if (!access) {
      setSession(null);
      setLoading(false);
      setReady(true);
      return;
    }

    try {
      const { data } = await api.get<Session>("/auth/me");
      setSession(data);
      // Re-register on every launch: Expo tokens can rotate, and the server
      // prunes devices that stop responding. Never prompts — only registers
      // if permission was already granted from Settings.
      registerForPush().catch(() => undefined);
    } catch (error) {
      // An expired session is expected and already handled by the client; a
      // network failure is not a reason to throw someone out of the app, so
      // the session simply stays unknown until connectivity returns.
      if (error instanceof ApiError && !error.isOffline) {
        await tokens.clear();
        setSession(null);
      }
    } finally {
      setLoading(false);
      setReady(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // The client signs out on an unrecoverable 401; the UI has to follow.
  useEffect(() => onSignedOut(() => setSession(null)), []);

  const adopt = useCallback(
    async (data: { mode: string; accessToken?: string; refreshToken?: string; mfaToken?: string; session?: Session } | null): Promise<SignInOutcome> => {
      if (data?.mode === "mfa_required" && data.mfaToken) {
        return { mfaRequired: true, mfaToken: data.mfaToken };
      }

      if (!data?.accessToken) {
        // Multi-workspace accounts and platform staff take other paths on the
        // web. Neither belongs in an employee app, and pretending otherwise
        // would strand the user on a blank screen.
        throw new ApiError(
          data?.mode === "select_organization"
            ? "This account belongs to more than one workspace. Please use the web portal to sign in."
            : "This account cannot sign in to the employee app.",
          { code: "UNSUPPORTED_LOGIN_MODE" }
        );
      }

      await tokens.set(data.accessToken, data.refreshToken);
      const me = data.session ?? (await api.get<Session>("/auth/me")).data;
      setSession(me);
      registerForPush().catch(() => undefined);
      return { mfaRequired: false };
    },
    []
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { data } = await api.post<{ mode: string; accessToken?: string; refreshToken?: string; mfaToken?: string; session?: Session }>(
        "/auth/login",
        { email, password },
        { skipAuth: true }
      );
      return adopt(data);
    },
    [adopt]
  );

  const completeMfa = useCallback(
    async (mfaToken: string, code: string) => {
      const { data } = await api.post<{ mode: string; accessToken?: string; refreshToken?: string; session?: Session }>(
        "/auth/mfa/verify",
        { mfaToken, token: code },
        { skipAuth: true }
      );
      await adopt(data);
    },
    [adopt]
  );

  const signOut = useCallback(async () => {
    // Best effort: the local session must end even if the server is
    // unreachable, or a user on a plane can never sign out of a lost phone.
    // The push token goes first, while the access token still works.
    await unregisterPush().catch(() => undefined);
    await api.post("/auth/logout").catch(() => undefined);
    await tokens.clear();
    setSession(null);
  }, []);

  const can = useCallback(
    (...permissions: string[]) => {
      if (!session) return false;
      return permissions.every((permission) => session.permissions.includes(permission));
    },
    [session]
  );

  const value = useMemo<SessionValue>(
    () => ({ session, loading, ready, signIn, completeMfa, signOut, refresh: load, can }),
    [session, loading, ready, signIn, completeMfa, signOut, load, can]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside SessionProvider");
  return context;
}
