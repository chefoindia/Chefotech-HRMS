/* eslint-disable no-restricted-globals */
/**
 * Push service worker.
 *
 * Deliberately minimal: it shows the notification the server sent and opens
 * the right page when it is clicked. It caches nothing and intercepts no
 * fetches, so it can never serve a stale build of the app — the failure mode
 * that makes people distrust service workers.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Chefotech HRMS", body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "Chefotech HRMS";
  const options = {
    body: payload.body || "",
    icon: payload.icon || "/icon.png",
    badge: "/icon.png",
    data: payload.data || {},
    tag: payload.data && payload.data.notificationId ? String(payload.data.notificationId) : undefined,
    renotify: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.actionUrl) || "/me/notifications";
  const url = new URL(target, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      // Reuse an open tab of the app rather than piling up a new one per click.
      for (const client of windows) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
