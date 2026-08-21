// App.js
import React, { useEffect, useRef, useState } from "react";
import { Alert, Platform } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { AuthProvider } from "./src/context/AuthContext";
import { ThemeProvider } from "./src/theme";
import { BadgeProvider } from "./src/lib/badges";
import { useFonts } from "expo-font";
import {
  Manrope_300Light,
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from "@expo-google-fonts/manrope";
import AppNavigator, { navigationRef } from "./src/navigation/AppNavigator";
import {
  addNotificationListeners,
  setupNotificationCategories,
} from "./src/utils/notifications";
import { getApiUrl, ROOT_URL } from "./src/lib/api";
import ForceUpdateModal from "./src/components/ForceUpdateModal";

function isVersionOlder(current, minimum) {
  if (!current || !minimum) return false;
  const c = current.split(".").map(Number);
  const m = minimum.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((c[i] || 0) < (m[i] || 0)) return true;
    if ((c[i] || 0) > (m[i] || 0)) return false;
  }
  return false;
}

// Push payloads carry a bare route name (`data.screen` — see the notification
// contract in utils/notifyEmployee.js on the backend). Every one of those routes
// lives inside the WorkStack, which is itself the "Work" TAB inside "Main" —
// three navigators deep. Navigating to `{ screen: "Leave" }` from the root
// therefore looks for a TAB called "Leave", finds none, and does nothing at all:
// no throw, no log, the tap simply dies. The nesting has to be spelled out.
//
// Routes that are direct children of MainTabs are passed straight through, so
// this keeps working if a screen is ever promoted to its own tab.
const TAB_ROUTES = new Set(["Home", "Work", "Standings", "Pay", "Profile"]);
const WORK_ROUTES = new Set([
  "WorkHub",
  "Regularize",
  "Leave",
  "Overtime",
  "Attendance",
  "Performance",
]);

function deepLink(screen) {
  if (!screen || !navigationRef.current?.isReady()) return;
  try {
    if (TAB_ROUTES.has(screen)) {
      navigationRef.current.navigate("Main", { screen });
    } else if (WORK_ROUTES.has(screen)) {
      navigationRef.current.navigate("Main", {
        screen: "Work",
        params: { screen },
      });
    } else {
      console.warn(`[PUSH] Unknown deep-link target "${screen}" — ignored`);
    }
  } catch (e) {
    console.warn("[PUSH] Navigation failed:", e.message);
  }
}

async function authenticatedFetch(url, opts = {}) {
  const token = await AsyncStorage.getItem("employee_token");
  if (!token) return null;
  const res = await fetch(url, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Cookie: `employee_token=${token}`,
      Authorization: `Bearer ${token}`,
      ...opts.headers,
    },
  });
  return res.json();
}

async function handleLeaveAction(leaveId, action) {
  try {
    const endpoint = `/leave-applications/manager/${leaveId}/${action}`;
    const result = await authenticatedFetch(getApiUrl(endpoint), {
      method: "PATCH",
      body: JSON.stringify({
        remarks: `${action === "approve" ? "Approved" : "Rejected"} from notification`,
      }),
    });
    if (result?.success) {
      Alert.alert(
        action === "approve" ? "Leave Approved" : "Leave Rejected",
        result.message ||
          `Leave has been ${action === "approve" ? "approved" : "rejected"}.`,
      );
    } else {
      Alert.alert(
        "Action Failed",
        result?.message || "Could not process. Please try from the Leave tab.",
      );
    }
  } catch (e) {
    console.error("[PUSH] Leave action error:", e.message);
    Alert.alert("Error", "Network error. Open the Leave tab to try again.");
  }
}

export default function App() {
  const notifCleanup = useRef(null);

  // Named faces must be registered before any Text renders, because React
  // Native silently falls back to the system font for an unknown fontFamily
  // rather than erroring — the app would look "almost right" and nobody would
  // know why. `error` is treated as loaded on purpose: a font that fails to
  // register should degrade to the system face, never block the app.
  const [fontsLoaded, fontError] = useFonts({
    Manrope_300Light,
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
  });
  const [forceUpdate, setForceUpdate] = useState(false);
  const [updateMessage, setUpdateMessage] = useState("");

  // ── Version check ──────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const currentVersion =
          Constants.expoConfig?.version ||
          Constants.manifest?.version ||
          "1.0.0";
        console.log("[VERSION] Current app version:", currentVersion);
        console.log("[VERSION] Fetching from:", `${ROOT_URL}/api/app/version`);

        const res = await fetch(`${ROOT_URL}/api/app/version`);
        const text = await res.text();
        if (text.startsWith("<")) {
          console.warn("[VERSION] Got HTML — endpoint not found");
          return;
        }
        const data = JSON.parse(text);
        console.log("[VERSION] Server says minVersion:", data.data?.minVersion);
        if (data.success && data.data?.minVersion) {
          const older = isVersionOlder(currentVersion, data.data.minVersion);
          console.log("[VERSION] Is current older than min?", older);
          if (older) {
            setUpdateMessage(data.data.message || "");
            setForceUpdate(true);
          }
        }
      } catch (e) {
        console.warn("[VERSION] Check failed:", e.message);
      }
    })();
  }, []);

  // ── Native push notification listeners (skip on web) ──────────────────────
  // expo-notifications listeners are NOT available on web.
  // Web push is handled by the FCM service worker + webNotifications.js.
  useEffect(() => {
    if (Platform.OS === "web") return; // ← web guard: skip all expo-notifications

    // setupNotificationCategories and addNotificationListeners are already
    // guarded inside notifications.js, but the guard here prevents
    // even calling them on web to avoid any bundling issues.
    setupNotificationCategories();

    notifCleanup.current = addNotificationListeners(
      (notification) => {
        console.log(
          "[PUSH] Received in foreground:",
          notification.request.content.title,
        );
      },
      (response) => {
        const data = response.notification.request.content.data;
        const actionId = response.actionIdentifier;
        console.log("[PUSH] Notification interaction, action:", actionId);

        if (actionId === "APPROVE_LEAVE" && data?.leaveId) {
          handleLeaveAction(data.leaveId, "approve");
          deepLink("Leave");
          return;
        }
        if (actionId === "REJECT_LEAVE" && data?.leaveId) {
          handleLeaveAction(data.leaveId, "reject");
          deepLink("Leave");
          return;
        }
        if (data?.screen) deepLink(data.screen);
      },
    );

    return () => {
      if (notifCleanup.current) notifCleanup.current();
    };
  }, []);

  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        {/* ThemeProvider wraps AuthProvider because the splash and onboarding
            screens render before any session exists and still need colours. */}
        <ThemeProvider>
          <AuthProvider>
            <BadgeProvider>
            {/* `auto` follows the resolved scheme, so the clock and battery
                icons stay legible when the user flips to dark. */}
            <StatusBar style="auto" />
            <AppNavigator />
            <ForceUpdateModal visible={forceUpdate} message={updateMessage} />
            </BadgeProvider>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
