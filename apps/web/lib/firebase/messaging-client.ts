"use client";

import { deleteToken, getToken, onMessage } from "firebase/messaging";
import { getMessagingInstance, firebaseConfigured, serviceWorkerConfigParams } from "@/lib/firebase/client";

// FCM web push — browser-side registration flow (added 2026-07-15). This is
// the only place that talks to the Notification permission API and the
// service worker; the Settings page toggle (components/settings/) is the
// only caller. Deliberately opt-in — nothing here runs unless the user
// clicks "Enable".

const STORAGE_KEY = "pikorua_push_token";
const SW_PATH = "/firebase-messaging-sw.js";

export type PushSupport = "unsupported" | "unconfigured" | "denied" | "ready";

export function pushSupportStatus(): PushSupport {
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) {
    return "unsupported";
  }
  if (!firebaseConfigured()) return "unconfigured";
  if (Notification.permission === "denied") return "denied";
  return "ready";
}

export function currentStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  const url = `${SW_PATH}?${serviceWorkerConfigParams()}`;
  return navigator.serviceWorker.register(url);
}

/** Request permission (if needed), register the SW, get an FCM token, and register it server-side. */
export async function enablePush(): Promise<string> {
  if (!("Notification" in window)) throw new Error("This browser does not support notifications.");

  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission was not granted.");
  }

  const messaging = await getMessagingInstance();
  if (!messaging) throw new Error("Push notifications are not configured for this deployment.");

  const registration = await registerServiceWorker();
  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
  if (!vapidKey) throw new Error("Push notifications are not configured (missing VAPID key).");

  const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
  if (!token) throw new Error("Could not obtain a push token from the browser.");

  const res = await fetch("/api/v1/notifications/push-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);

  window.localStorage.setItem(STORAGE_KEY, token);

  // Foreground messages aren't shown by the browser automatically (that's
  // the service worker's job for background tabs) — show them manually here.
  onMessage(messaging, (payload) => {
    const title = payload.notification?.title ?? "Pikorua HRM";
    const body = payload.notification?.body ?? "";
    if (Notification.permission === "granted") {
      new Notification(title, { body, icon: "/icon-192.png" });
    }
  });

  return token;
}

/** Unregister the current device's token, both server-side and from FCM. */
export async function disablePush(): Promise<void> {
  const token = currentStoredToken();
  if (token) {
    await fetch("/api/v1/notifications/push-token", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => undefined);
  }
  const messaging = await getMessagingInstance();
  if (messaging) {
    await deleteToken(messaging).catch(() => undefined);
  }
  window.localStorage.removeItem(STORAGE_KEY);
}
