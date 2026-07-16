// FCM background service worker (added 2026-07-15). Static files under
// public/ can't read Next's NEXT_PUBLIC_* env vars, so the client passes the
// Firebase web config as a query string when registering this worker (see
// lib/firebase/messaging-client.ts registerPush()) — this file parses it
// back out. Handles push events received while the app is not in the
// foreground tab; foreground pushes are handled by onMessage() in the app
// itself (see the same file) so they don't double-fire.

importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

const params = new URLSearchParams(self.location.search);
const firebaseConfig = {
  apiKey: params.get("apiKey"),
  authDomain: params.get("authDomain"),
  projectId: params.get("projectId"),
  messagingSenderId: params.get("messagingSenderId"),
  appId: params.get("appId"),
};

if (firebaseConfig.apiKey) {
  firebase.initializeApp(firebaseConfig);
  const messaging = firebase.messaging();

  // Messages are sent data-only (see lib/notifications/fcm.ts) so that the SDK
  // does not auto-display them alongside this handler — that double-fired every
  // push. Title/body therefore live in `data`, not `notification`.
  messaging.onBackgroundMessage((payload) => {
    const data = payload.data ?? {};
    const title = data.title ?? "Pikorua HRM";
    const body = data.body ?? "";
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      data: { url: data.link ?? "/notifications" },
    });
  });
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/notifications";
  event.waitUntil(self.clients.openWindow(url));
});
