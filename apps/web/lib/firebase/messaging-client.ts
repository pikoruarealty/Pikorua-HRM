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

// Guards against stacking duplicate onMessage listeners across repeated
// enablePush() calls within the same page session.
let foregroundHandlerBound = false;

export type PushSupport = "unsupported" | "unconfigured" | "denied" | "ready";

/** Brave exposes this to let sites detect it (its own opt-in API, not a UA sniff). */
export async function isBraveBrowser(): Promise<boolean> {
  const brave = (navigator as unknown as { brave?: { isBrave?: () => Promise<boolean> } }).brave;
  if (!brave?.isBrave) return false;
  return brave.isBrave().catch(() => false);
}

// Brave ships with "Use Google services for push messaging" OFF by default
// (its own privacy setting, in brave://settings/privacy) — this blocks the
// underlying push service FCM's getToken() depends on, and the browser
// throws a bare "Registration failed - push service error" with no
// actionable detail. Not a bug in this app; rewrite it into something a user
// can actually act on.
function translatePushError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/push service error/i.test(message)) {
    return (
      "Your browser blocked the push service. In Brave, go to Settings → Privacy and " +
      "security → \"Use Google services for push messaging\" and turn it on, then reload " +
      "this page and try again."
    );
  }
  return message;
}

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

/** Resolve once `registration` has an activated worker, or reject on timeout. */
function waitForActivation(
  registration: ServiceWorkerRegistration,
  timeoutMs = 10_000,
): Promise<void> {
  if (registration.active) return Promise.resolve();

  const worker = registration.installing ?? registration.waiting;
  if (!worker) {
    // No worker on this registration yet — fall back to whatever ends up
    // controlling our scope (navigator.serviceWorker.ready resolves on active).
    return navigator.serviceWorker.ready.then(() => undefined);
  }

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.removeEventListener("statechange", onStateChange);
      reject(new Error("The notification service worker did not start in time. Reload and try again."));
    }, timeoutMs);

    function onStateChange() {
      if (worker!.state === "activated") {
        clearTimeout(timer);
        worker!.removeEventListener("statechange", onStateChange);
        resolve();
      } else if (worker!.state === "redundant") {
        clearTimeout(timer);
        worker!.removeEventListener("statechange", onStateChange);
        reject(new Error("The notification service worker failed to install."));
      }
    }

    worker.addEventListener("statechange", onStateChange);
  });
}

async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  const url = `${SW_PATH}?${serviceWorkerConfigParams()}`;
  const registration = await navigator.serviceWorker.register(url);

  // register() resolves as soon as the *registration* exists — its worker may
  // still be "installing"/"waiting". getToken() calls PushManager.subscribe(),
  // which requires an ACTIVE worker and otherwise fails with "Subscription
  // failed - no active Service Worker". Wait for activation before handing the
  // registration to FCM.
  await waitForActivation(registration);
  return registration;
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

  let token: string;
  try {
    token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
  } catch (err) {
    throw new Error(translatePushError(err));
  }
  if (!token) throw new Error("Could not obtain a push token from the browser.");

  // FCM can hand this browser a new token (a SW code change, cleared storage,
  // etc.) without invalidating whatever token it issued before — so unless we
  // explicitly clean up the old one, this device ends up with two live rows in
  // push_tokens and receives every push twice. Best-effort: a failed cleanup
  // just leaves a stale row for sendPushToUser's dead-token pruning to catch
  // later, it must never block getting the new token registered.
  const previousToken = currentStoredToken();
  if (previousToken && previousToken !== token) {
    await fetch("/api/v1/notifications/push-token", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: previousToken }),
    }).catch(() => undefined);
  }

  const res = await fetch("/api/v1/notifications/push-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);

  window.localStorage.setItem(STORAGE_KEY, token);

  // Foreground messages aren't shown by the browser automatically (that's the
  // service worker's job for background tabs) — show them manually here.
  // Bound at most once per page: enablePush() can be called repeatedly (the
  // toggle, retries), and each onMessage() call adds another listener, which
  // showed one duplicate notification per extra registration.
  if (!foregroundHandlerBound) {
    foregroundHandlerBound = true;
    onMessage(messaging, (payload) => {
      const title = payload.notification?.title ?? "Pikorua HRM";
      const body = payload.notification?.body ?? "";
      if (Notification.permission === "granted") {
        new Notification(title, { body, icon: "/icon-192.png" });
      }
    });
  }

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
