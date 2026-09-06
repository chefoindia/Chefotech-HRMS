import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { api } from "../api/client";
import { BRAND } from "../brand";

/**
 * Push registration.
 *
 * The app already asked for notification permission and showed a switch in
 * Settings — and then did nothing with the answer. No token was ever
 * obtained, nothing was sent to the server, and the backend had no push
 * transport, so the switch was honest only in the sense that it did not lie
 * about a feature that did not exist.
 *
 * Now: after sign-in (and on every launch while signed in) the Expo push
 * token is fetched and registered against the account. Sign-out removes it,
 * so a phone handed to a colleague does not keep receiving the first
 * person's payslip alerts.
 */

const TOKEN_KEY = "chefotech.pushToken";

/** How a notification is shown while the app is in the foreground. */
export function configureForegroundHandling() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

async function ensureAndroidChannel() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("default", {
    name: "General",
    importance: Notifications.AndroidImportance.HIGH,
    sound: "default",
    vibrationPattern: [0, 250, 250, 250],
  });
}

/**
 * Obtain the token and register it. Resolves to the token, or null when the
 * device cannot receive push (simulator, permission refused, no EAS project).
 *
 * @param {object} [options]
 * @param {boolean} [options.ask]  prompt for permission if not yet granted.
 *        Default false: launch-time registration must never surprise someone
 *        with a system dialog; the Settings switch passes true.
 */
export async function registerForPush({ ask = false }: { ask?: boolean } = {}): Promise<string | null> {
  if (!Device.isDevice) return null;

  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted" && ask) {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== "granted") return null;

  await ensureAndroidChannel();

  // EAS builds need the project id to mint a token. It comes from app.json
  // (extra.eas.projectId) once `eas init` has been run; Expo Go can do without.
  const projectId =
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
    (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId;

  let token: string;
  try {
    token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
  } catch (error) {
    // Typically "no projectId" on a store build that skipped `eas init`.
    console.warn("[push] could not obtain an Expo push token", error);
    return null;
  }

  try {
    await api.post("/notifications/devices", {
      kind: "expo",
      token,
      platform: Platform.OS === "ios" ? "ios" : "android",
      deviceName: [Device.manufacturer, Device.modelName].filter(Boolean).join(" ").trim(),
      appVersion: BRAND.version,
    });
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  } catch (error) {
    console.warn("[push] could not register the token with the server", error);
    return null;
  }

  return token;
}

/** Forget this device on the server. Best effort — never blocks sign-out. */
export async function unregisterPush(): Promise<void> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null);
  if (!token) return;
  await api.delete("/notifications/devices", { body: { token } }).catch(() => undefined);
  await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined);
}

export async function isRegisteredForPush(): Promise<boolean> {
  return Boolean(await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null));
}
