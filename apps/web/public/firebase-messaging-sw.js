// FCM background service worker (added 2026-07-15). Static files under
// public/ can't read Next's NEXT_PUBLIC_* env vars, so the client passes the
// Firebase web config as a query string when registering this worker (see
// lib/firebase/messaging-client.ts registerPush()) — this file parses it
// back out. Background pushes are rendered by the FCM SDK itself (see below);
// foreground pushes reach onMessage() in the app instead, which the SDK never
// displays automatically, so the app renders those by hand.

importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

// Without these, a new SW version sits in "waiting" until every open tab of the
// app is fully closed, so a change here can run against a stale worker for a
// long time. skipWaiting() activates a newly installed worker immediately
// instead; clients.claim() then hands it control of already-open tabs without
// needing a reload.
self.addEventListener("install", () => {
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

const params = new URLSearchParams(self.location.search);
const firebaseConfig = {
  apiKey: params.get("apiKey"),
  authDomain: params.get("authDomain"),
  projectId: params.get("projectId"),
  messagingSenderId: params.get("messagingSenderId"),
  appId: params.get("appId"),
};

// Calling firebase.messaging() is the whole job here: it installs the SDK's own
// `push` and `notificationclick` listeners, and those do all the work.
//
// On push, the SDK auto-displays any message carrying a `notification` payload
// (title/body/icon) — and separately calls an onBackgroundMessage handler if one
// is registered. Registering one here would therefore show every push TWICE, so
// we deliberately don't. Title/body rendering lives entirely in the payload that
// the server sends (see lib/notifications/fcm.ts); on click, the SDK opens
// `webpush.fcmOptions.link` from that same payload.
//
// Keep it that way: anything this file renders itself is only as fresh as this
// file, and a service worker can linger in a browser long after a deploy.
if (firebaseConfig.apiKey) {
  firebase.initializeApp(firebaseConfig);
  firebase.messaging();
}
