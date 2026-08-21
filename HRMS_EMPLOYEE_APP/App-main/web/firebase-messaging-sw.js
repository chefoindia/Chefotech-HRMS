// public/firebase-messaging-sw.js
//
// MUST live at: App/public/firebase-messaging-sw.js
// Expo web serves the public/ folder at the root URL.
//
// Project: grav-cms-38f45 — matches src/utils/webNotifications.js

importScripts(
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js",
);
importScripts(
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js",
);

const firebaseConfig = {
  apiKey: "AIzaSyDpswQ3pSlbxtmc-yWDgJD2GQWjfpK3ZXs",
  authDomain: "grav-cms-38f45.firebaseapp.com",
  databaseURL: "https://grav-cms-38f45-default-rtdb.firebaseio.com",
  projectId: "grav-cms-38f45",
  storageBucket: "grav-cms-38f45.firebasestorage.app",
  messagingSenderId: "51268280312",
  appId: "1:51268280312:web:1667f085583f9fe4b6c00d",
  measurementId: "G-PPVRC8MR2Y",
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// ── Background message handler ────────────────────────────────────────────────
// Fires when a push notification arrives while:
//   • The tab is in the background / minimised
//   • The browser is open but GRAV tab is not focused
//   • The browser is closed entirely (browser wakes the SW up)
messaging.onBackgroundMessage((payload) => {
  console.log("[SW] Background message received:", payload);

  const { title, body, icon, image } = payload.notification || {};
  const data = payload.data || {};

  const notificationTitle = title || "GRAV";
  const notificationOptions = {
    body: body || "",
    icon: icon || "/icon.png",
    badge: "/icon.png",
    image: image,
    data: { ...data, url: data.url || "/" },
    requireInteraction: false,
    tag: data.tag || "grav-notification",
    actions: data.actionLabel
      ? [{ action: "open", title: data.actionLabel }]
      : [],
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// ── Notification click handler ─────────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && "focus" in client) {
            client.focus();
            if (url !== "/") client.navigate(url);
            return;
          }
        }
        if (clients.openWindow) return clients.openWindow(url);
      }),
  );
});

// ── Push event fallback ───────────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    if (data.notification) return; // FCM already handled
    const title = data.title || "GRAV";
    const options = {
      body: data.body || "",
      icon: "/icon.png",
      badge: "/icon.png",
      data,
    };
    event.waitUntil(self.registration.showNotification(title, options));
  } catch (_) {}
});
