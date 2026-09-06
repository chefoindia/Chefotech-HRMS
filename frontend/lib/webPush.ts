"use client";

import { api } from "./api";

/**
 * Browser push, end to end.
 *
 * The service worker at /push-sw.js receives the push and shows it; this
 * module handles permission, subscription, and telling the API about the
 * subscription so the notification service can find this browser.
 *
 * Nothing here is automatic. Asking for notification permission the moment
 * a page loads is the fastest way to be permanently blocked, so the prompt
 * only ever runs from a button the person clicked.
 */

const SW_PATH = "/push-sw.js";

export type PushSupport = "unsupported" | "denied" | "prompt" | "granted";

export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission === "granted") return "granted";
  return "prompt";
}

async function serverConfig() {
  const { data } = await api.get<{ web: boolean; vapidPublicKey: string | null }>("/notifications/push/config");
  return data;
}

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalised);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

async function registration() {
  return navigator.serviceWorker.register(SW_PATH, { scope: "/" });
}

/** The current subscription for this browser, if any. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() === "unsupported") return null;
  const reg = await navigator.serviceWorker.getRegistration(SW_PATH).catch(() => null);
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

/**
 * Ask for permission, subscribe, and register with the API.
 * @returns "subscribed" | "denied" | "unavailable"
 */
export async function enableBrowserPush(): Promise<"subscribed" | "denied" | "unavailable"> {
  if (pushSupport() === "unsupported") return "unavailable";

  const config = await serverConfig();
  if (!config.web || !config.vapidPublicKey) return "unavailable";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";

  const reg = await registration();
  await navigator.serviceWorker.ready;

  const subscription =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey),
    }));

  await api.post("/notifications/devices", {
    kind: "web",
    subscription: subscription.toJSON(),
    platform: "web",
    deviceName: describeBrowser(),
  });

  return "subscribed";
}

export async function disableBrowserPush(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await api.delete("/notifications/devices", { token: subscription.endpoint }).catch(() => undefined);
  await subscription.unsubscribe().catch(() => undefined);
}

function describeBrowser() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad/.test(ua)
        ? "iOS"
        : /Mac OS/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return [browser, os].filter(Boolean).join(" on ");
}
