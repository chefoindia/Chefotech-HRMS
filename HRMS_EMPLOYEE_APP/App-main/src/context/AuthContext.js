// src/context/AuthContext.js
//
// Login/logout flow with platform-aware push token management:
//   • On login: registers Expo token (mobile) or FCM token (web) — never both
//   • On logout: tells backend which platform is logging out, so the OTHER
//                platform's token stays intact

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { getApiUrl } from "../lib/api";
import API_CONFIG from "../lib/api";

const AuthContext = createContext(null);

function normalizeUser(data) {
  if (!data) return null;
  return { ...data, _id: data._id || data.id, id: data.id || data._id };
}

function extractTokenFromHeaders(res) {
  try {
    let cookie =
      res.headers?.get?.("set-cookie") || res.headers?.get?.("Set-Cookie");
    if (!cookie && res.headers?.map)
      cookie = res.headers.map["set-cookie"] || res.headers.map["Set-Cookie"];
    if (cookie) {
      const m = String(cookie).match(/employee_token=([^;]+)/);
      if (m) return m[1];
    }
  } catch (_) {}
  return null;
}

// ── Native push token (Expo — Android/iOS only) ───────────────────────────────
async function registerNativePushToken(apiFetchFn) {
  try {
    const {
      registerForPushNotifications,
      clearBadgeCount,
    } = require("../utils/notifications");
    clearBadgeCount();
    const pushToken = await registerForPushNotifications();
    if (!pushToken) {
      console.warn("[PUSH] No native token returned");
      return null;
    }

    console.log("════════════════════════════════════════════════════════");
    console.log("[PUSH] 🔑 YOUR CURRENT TOKEN (mobile):");
    console.log("[PUSH] " + pushToken);
    console.log("════════════════════════════════════════════════════════");

    const response = await apiFetchFn(getApiUrl("/push-token"), {
      method: "POST",
      body: JSON.stringify({ pushToken }), // route auto-detects as mobile
    });
    if (response.success) {
      console.log("[PUSH] ✅ Native token sent to backend");
    } else {
      console.warn("[PUSH] ⚠ Backend rejected token:", response.message);
    }
    return pushToken;
  } catch (e) {
    console.warn("[PUSH] Native registration failed:", e.message);
    return null;
  }
}

// ── Web push token (FCM — browser only) ───────────────────────────────────────
async function registerWebPushToken(apiFetchFn) {
  try {
    const { requestWebPushPermission, onForegroundMessage } =
      await import("../utils/webNotifications");

    const fcmToken = await requestWebPushPermission();
    if (!fcmToken) return null;

    const response = await apiFetchFn(getApiUrl("/push-token"), {
      method: "POST",
      body: JSON.stringify({ fcmToken, platform: "web" }),
    });
    if (response.success) {
      console.log("[WEB-PUSH] ✅ FCM token sent to backend");
    } else {
      console.warn("[WEB-PUSH] ⚠ Backend rejected token:", response.message);
    }

    onForegroundMessage((payload) => {
      console.log(
        "[WEB-PUSH] Foreground notification:",
        payload?.notification?.title,
      );
    });
    return fcmToken;
  } catch (e) {
    console.warn("[WEB-PUSH] Web push registration failed:", e.message);
    return null;
  }
}

// ── Unified push registration ─────────────────────────────────────────────────
async function registerPushTokenWithBackend(apiFetchFn) {
  if (Platform.OS === "web") {
    return await registerWebPushToken(apiFetchFn);
  }
  return await registerNativePushToken(apiFetchFn);
}

// ── Platform-aware logout cleanup ─────────────────────────────────────────────
// Tells the backend WHICH platform's token to clear. The other platform's
// token stays intact — so logging out on web doesn't kill mobile push.
async function deletePushTokenOnLogout(apiFetchFn) {
  const platform = Platform.OS === "web" ? "web" : "mobile";

  try {
    await apiFetchFn(getApiUrl(`/push-token?platform=${platform}`), {
      method: "DELETE",
    });
    console.log(`[PUSH] ✅ ${platform} token cleared from backend`);
  } catch (e) {
    console.warn(`[PUSH] Backend ${platform} token delete failed:`, e.message);
  }

  // Also delete the Firebase-side web token so next login forces a fresh one
  if (Platform.OS === "web") {
    try {
      const { deleteWebPushToken } = await import("../utils/webNotifications");
      await deleteWebPushToken();
    } catch (_) {}
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const tokenRef = useRef(null);
  const hasRegisteredPushRef = useRef(false);

  const coreFetch = useCallback(async (url, opts = {}) => {
    const token =
      tokenRef.current || (await AsyncStorage.getItem("employee_token"));
    const isFormData = opts.body instanceof FormData;
    const headers = {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Cookie: `employee_token=${token}` } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    };
    const res = await fetch(url, { ...opts, headers, credentials: "include" });
    const newToken = extractTokenFromHeaders(res);
    if (newToken) {
      tokenRef.current = newToken;
      await AsyncStorage.setItem("employee_token", newToken);
    }
    return res;
  }, []);

  const apiFetch = useCallback(
    async (url, opts = {}) => {
      const res = await coreFetch(url, opts);
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (_) {
        throw new Error(
          `Server returned non-JSON response (HTTP ${res.status})`,
        );
      }
      if (!res.ok && !data.success)
        throw new Error(data.message || `HTTP ${res.status}`);
      return data;
    },
    [coreFetch],
  );

  // ── Session restore on app start ─────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const token = await AsyncStorage.getItem("employee_token");
        if (!token) {
          setLoading(false);
          return;
        }
        tokenRef.current = token;
        const data = await apiFetch(
          getApiUrl(API_CONFIG.endpoints.auth.verify),
        );
        if (data.success && data.data) {
          setUser(normalizeUser(data.data));
          if (!hasRegisteredPushRef.current) {
            hasRegisteredPushRef.current = true;
            registerPushTokenWithBackend(apiFetch);
          }
        } else {
          await AsyncStorage.removeItem("employee_token");
          tokenRef.current = null;
        }
      } catch (_) {
        await AsyncStorage.removeItem("employee_token");
        tokenRef.current = null;
      } finally {
        setLoading(false);
      }
    })();
  }, [apiFetch]);

  // ── Login ─────────────────────────────────────────────────────────────────
  const login = async (phoneNumber, password, rememberMe = false) => {
    try {
      const res = await coreFetch(getApiUrl(API_CONFIG.endpoints.auth.login), {
        method: "POST",
        body: JSON.stringify({ phoneNumber, password, rememberMe }),
      });
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (_) {
        return {
          success: false,
          message: "Server returned an invalid response",
        };
      }
      if (!data.success)
        return { success: false, message: data.message || "Login failed" };

      const bodyToken = data.data?.token;
      const headerToken = extractTokenFromHeaders(res);
      const token = bodyToken || headerToken;
      if (token) {
        tokenRef.current = token;
        await AsyncStorage.setItem("employee_token", token);
      }

      let loggedInUser = null;
      for (const ep of [
        API_CONFIG.endpoints.profile.get,
        API_CONFIG.endpoints.auth.verify,
      ]) {
        try {
          const d = await apiFetch(getApiUrl(ep));
          if (d.success && d.data) {
            loggedInUser = normalizeUser(d.data);
            setUser(loggedInUser);
            break;
          }
        } catch (_) {}
      }
      if (!loggedInUser && data.data?.employee) {
        loggedInUser = normalizeUser(data.data.employee);
        setUser(loggedInUser);
      }

      hasRegisteredPushRef.current = true;
      setTimeout(() => {
        registerPushTokenWithBackend(apiFetch);
      }, 500);

      return { success: true };
    } catch (err) {
      return { success: false, message: err.message || "Network error" };
    }
  };

  // ── Logout ────────────────────────────────────────────────────────────────
  const logout = async () => {
    // Clear only THIS platform's token (web or mobile, not both)
    await deletePushTokenOnLogout(apiFetch);

    try {
      await coreFetch(getApiUrl(API_CONFIG.endpoints.auth.logout), {
        method: "POST",
      });
    } catch (_) {}

    await AsyncStorage.removeItem("employee_token");
    tokenRef.current = null;
    hasRegisteredPushRef.current = false;
    setUser(null);
  };

  const apiUpload = useCallback(
    async (url, formData) => {
      const res = await coreFetch(url, { method: "POST", body: formData });
      return await res.json();
    },
    [coreFetch],
  );

  return (
    <AuthContext.Provider
      value={{ user, loading, login, logout, apiFetch, apiUpload }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
