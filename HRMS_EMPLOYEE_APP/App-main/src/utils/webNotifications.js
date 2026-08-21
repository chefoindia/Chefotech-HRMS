// src/utils/webNotifications.js
//
// Web Push via Firebase Cloud Messaging (FCM).
// Project: grav-cms-38f45 — matches the backend's FIREBASE_SERVICE_ACCOUNT.
//
// IMPORTANT: This file does NOT import `firebase` as an NPM package.
// Metro can't reliably bundle Firebase v10/v12 for web (module resolution
// fails with "Requiring unknown module" errors regardless of cache clears).
//
// Instead, we load Firebase from Google's CDN at runtime via script tags.
// This is what the service worker (firebase-messaging-sw.js) also does, so
// client and SW use the EXACT same SDK version — no protocol mismatches.

import { Platform } from "react-native";

// ── FIREBASE CONFIG (grav-cms-38f45) ──────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDpswQ3pSlbxtmc-yWDgJD2GQWjfpK3ZXs",
  authDomain: "grav-cms-38f45.firebaseapp.com",
  databaseURL: "https://grav-cms-38f45-default-rtdb.firebaseio.com",
  projectId: "grav-cms-38f45",
  storageBucket: "grav-cms-38f45.firebasestorage.app",
  messagingSenderId: "51268280312",
  appId: "1:51268280312:web:1667f085583f9fe4b6c00d",
  measurementId: "G-PPVRC8MR2Y",
};

const VAPID_KEY =
  "BNSlmIjpN73abub84TJ49fNdK1lNRSwryTPuF-FIJcGvXlLOE4xhu1y4gTmj99FkPpUFhiAYoi7fK7oB87P6-9c";

// Use the SAME version the service worker uses (firebase-messaging-sw.js)
const FIREBASE_SDK_VERSION = "10.7.1";
// ─────────────────────────────────────────────────────────────────────────────

let _firebaseApp = null;
let _messaging = null;
let _sdkLoadPromise = null;
let _foregroundUnsubscribe = null;

/** Load a script and resolve when ready. */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    // Already loaded?
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}

/**
 * Load Firebase SDK from Google CDN. Returns a cached promise so we only
 * load each script once even if called multiple times.
 */
async function loadFirebaseSDK() {
  if (Platform.OS !== "web") return null;
  if (typeof window === "undefined" || typeof document === "undefined")
    return null;

  if (_sdkLoadPromise) return _sdkLoadPromise;

  _sdkLoadPromise = (async () => {
    const base = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;
    await loadScript(`${base}/firebase-app-compat.js`);
    await loadScript(`${base}/firebase-messaging-compat.js`);
    return window.firebase;
  })();

  return _sdkLoadPromise;
}

export function resetWebPushState() {
  _firebaseApp = null;
  _messaging = null;
  if (_foregroundUnsubscribe) {
    _foregroundUnsubscribe();
    _foregroundUnsubscribe = null;
  }
}

async function getFirebaseMessaging() {
  if (Platform.OS !== "web") return null;
  if (_messaging) return _messaging;

  try {
    const firebase = await loadFirebaseSDK();
    if (!firebase) {
      console.warn("[WEB-PUSH] Firebase SDK failed to load");
      return null;
    }

    // Check browser support
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      console.warn("[WEB-PUSH] Browser doesn't support Web Push");
      return null;
    }

    if (!_firebaseApp) {
      _firebaseApp = firebase.apps?.length
        ? firebase.apps[0]
        : firebase.initializeApp(FIREBASE_CONFIG);
    }

    _messaging = firebase.messaging();
    return _messaging;
  } catch (err) {
    console.warn("[WEB-PUSH] Firebase init failed:", err.message);
    return null;
  }
}

async function registerServiceWorker() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator))
    return null;
  try {
    const reg = await navigator.serviceWorker.register(
      "/firebase-messaging-sw.js",
      { scope: "/" }
    );
    if (reg.installing) {
      await new Promise((resolve) => {
        reg.installing.addEventListener("statechange", (e) => {
          if (e.target.state === "activated") resolve();
        });
      });
    }
    // Wait for the service worker to be ready (controlled)
    await navigator.serviceWorker.ready;
    console.log("[WEB-PUSH] Service worker registered and active");
    return reg;
  } catch (err) {
    console.warn("[WEB-PUSH] Service worker registration failed:", err.message);
    return null;
  }
}

export async function requestWebPushPermission() {
  if (Platform.OS !== "web") return null;
  if (typeof window === "undefined" || !("Notification" in window)) {
    console.warn("[WEB-PUSH] Notifications not supported in this environment");
    return null;
  }

  let permission = Notification.permission;
  if (permission === "denied") {
    console.warn("[WEB-PUSH] Notification permission denied by user");
    return null;
  }
  if (permission !== "granted") {
    console.log("[WEB-PUSH] Requesting notification permission...");
    permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.warn("[WEB-PUSH] User did not grant notification permission");
      return null;
    }
  }

  const swReg = await registerServiceWorker();
  if (!swReg) return null;

  try {
    const messaging = await getFirebaseMessaging();
    if (!messaging) return null;

    const token = await messaging.getToken({
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: swReg,
    });

    if (token) {
      console.log("════════════════════════════════════════════════════════");
      console.log("[WEB-PUSH] 🔑 YOUR CURRENT FCM TOKEN:");
      console.log("[WEB-PUSH] " + token);
      console.log("════════════════════════════════════════════════════════");
    } else {
      console.warn("[WEB-PUSH] No FCM token returned — check VAPID key");
    }
    return token || null;
  } catch (err) {
    console.warn("[WEB-PUSH] getToken failed:", err.message);
    return null;
  }
}

export async function deleteWebPushToken() {
  if (Platform.OS !== "web") return;
  try {
    const messaging = await getFirebaseMessaging();
    if (messaging) {
      await messaging.deleteToken();
      console.log("[WEB-PUSH] FCM token deleted");
    }
  } catch (err) {
    console.warn("[WEB-PUSH] deleteToken failed:", err.message);
  } finally {
    resetWebPushState();
  }
}

export async function onForegroundMessage(callback) {
  if (Platform.OS !== "web") return () => {};
  try {
    const messaging = await getFirebaseMessaging();
    if (!messaging) return () => {};

    if (_foregroundUnsubscribe) {
      _foregroundUnsubscribe();
      _foregroundUnsubscribe = null;
    }

    _foregroundUnsubscribe = messaging.onMessage((payload) => {
      const { title, body, icon } = payload.notification || {};
      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        new Notification(title || "GRAV", {
          body: body || "",
          icon: icon || "/icon.png",
        });
      }
      callback?.(payload);
    });

    return _foregroundUnsubscribe;
  } catch (err) {
    console.warn("[WEB-PUSH] onMessage failed:", err.message);
    return () => {};
  }
}