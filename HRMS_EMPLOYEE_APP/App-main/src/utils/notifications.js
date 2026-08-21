// src/utils/notifications.js
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import Constants from "expo-constants";

// ── Web: skip ALL expo-notifications setup — web uses FCM via webNotifications.js
if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
}

// ── Android notification channels ─────────────────────────────────────────────
export async function setupNotificationChannel() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("payroll", {
    name: "Payroll Notifications",
    description: "Notifications for payslip generation and salary updates",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#6366F1",
    sound: "default",
  });
  await Notifications.setNotificationChannelAsync("general", {
    name: "General Notifications",
    description: "General updates from Grav CRM",
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: "default",
  });
}

// ── Notification categories (native only) ─────────────────────────────────────
export async function setupNotificationCategories() {
  // This API does not exist on web — skip silently
  if (Platform.OS === "web") return;
  try {
    await Notifications.setNotificationCategoryAsync("payroll", [
      {
        identifier: "OPEN_SALARY",
        buttonTitle: "Open",
        options: { opensAppToForeground: true },
      },
    ]);
    await Notifications.setNotificationCategoryAsync("leave_action", [
      {
        identifier: "APPROVE_LEAVE",
        buttonTitle: "Approve",
        options: { opensAppToForeground: true },
      },
      {
        identifier: "REJECT_LEAVE",
        buttonTitle: "Reject",
        options: { opensAppToForeground: true, isDestructive: true },
      },
    ]);
    await Notifications.setNotificationCategoryAsync("general", [
      {
        identifier: "OPEN_APP",
        buttonTitle: "Open",
        options: { opensAppToForeground: true },
      },
    ]);
    console.log("[PUSH] Notification categories registered");
  } catch (e) {
    console.warn("[PUSH] Failed to set notification categories:", e.message);
  }
}

// ── Request permission + get Expo Push Token (native only) ────────────────────
export async function registerForPushNotifications() {
  // Web uses FCM — handled separately in webNotifications.js
  if (Platform.OS === "web") return null;
  if (!Device.isDevice) return null;

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== "granted") return null;

  try {
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ||
      Constants.easConfig?.projectId;
    if (!projectId) return null;

    const pushToken = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = pushToken.data;

    await setupNotificationChannel();
    await setupNotificationCategories();
    return token;
  } catch (err) {
    console.warn("[PUSH] Token error:", err.message);
    return null;
  }
}

// ── Schedule a local notification ─────────────────────────────────────────────
export async function sendLocalNotification(title, body, data = {}) {
  if (Platform.OS === "web") return; // not supported on web via expo
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data,
      sound: "default",
      categoryIdentifier: "general",
      ...(Platform.OS === "android" ? { channelId: "general" } : {}),
    },
    trigger: null,
  });
}

// ── Add notification listeners (native only) ──────────────────────────────────
export function addNotificationListeners(onNotification, onResponse) {
  if (Platform.OS === "web") {
    // No-op on web — return empty cleanup
    return () => {};
  }
  const notifListener =
    Notifications.addNotificationReceivedListener(onNotification);
  const responseListener =
    Notifications.addNotificationResponseReceivedListener(onResponse);
  return () => {
    Notifications.removeNotificationSubscription(notifListener);
    Notifications.removeNotificationSubscription(responseListener);
  };
}

// ── Clear badge count ──────────────────────────────────────────────────────────
export async function clearBadgeCount() {
  if (Platform.OS === "web") return;
  try {
    await Notifications.setBadgeCountAsync(0);
  } catch (_) {}
}
