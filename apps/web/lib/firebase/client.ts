"use client";

import { initializeApp, getApps, type FirebaseOptions } from "firebase/app";
import { getMessaging, isSupported, type Messaging } from "firebase/messaging";

// FCM web push — client side (added 2026-07-15). Config values are all
// NEXT_PUBLIC_* (safe to expose — Firebase web config is not a secret, it's
// scoped by the project's API key restrictions + security rules). Guarded so
// importing this module never throws in SSR or when push isn't configured —
// callers must check `firebaseConfigured()` before using anything here.

export const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export function firebaseConfigured(): boolean {
  return !!(
    firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.messagingSenderId &&
    firebaseConfig.appId
  );
}

let messagingPromise: Promise<Messaging | null> | null = null;

/** Lazily initializes the Firebase app + Messaging instance (browser only). */
export function getMessagingInstance(): Promise<Messaging | null> {
  if (typeof window === "undefined" || !firebaseConfigured()) {
    return Promise.resolve(null);
  }
  if (!messagingPromise) {
    messagingPromise = isSupported().then((supported) => {
      if (!supported) return null;
      const app = getApps()[0] ?? initializeApp(firebaseConfig);
      return getMessaging(app);
    });
  }
  return messagingPromise;
}

/** Query string appended to the service-worker URL so it can init its own Firebase app (SW files can't read NEXT_PUBLIC_* env vars). */
export function serviceWorkerConfigParams(): string {
  return new URLSearchParams(
    Object.entries(firebaseConfig).filter(([, v]) => v) as [string, string][],
  ).toString();
}
