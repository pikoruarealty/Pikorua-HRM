import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { prisma } from "@/lib/db/prisma";
import { createLogger } from "@/lib/log";

// Firebase Cloud Messaging — server-side send (added 2026-07-15). Push is an
// additional delivery channel layered onto the existing `pushNotification()`
// (lib/notifications/push.ts): every in-app Notification also fans out to
// the target user's registered browsers via FCM. Missing/placeholder admin
// credentials degrade to a no-op with a warning (dev-friendly — mirrors how
// GROQ_API_KEY/S3 creds are optional elsewhere), never a thrown error, since
// a push failure must never block the underlying business mutation (same
// fire-and-safe contract as `audit()`).

const logger = createLogger("fcm");

// Error codes that mean *this token is dead* and should be dropped. Kept
// deliberately narrow — see the invalid-argument note in sendPushToUser().
const DEAD_TOKEN_CODES = [
  "registration-token-not-registered",
  "invalid-registration-token",
];

function isConfigured(): boolean {
  return !!(
    process.env.FIREBASE_ADMIN_PROJECT_ID &&
    process.env.FIREBASE_ADMIN_CLIENT_EMAIL &&
    process.env.FIREBASE_ADMIN_PRIVATE_KEY
  );
}

let app: App | null = null;

function getFirebaseApp(): App | null {
  if (!isConfigured()) return null;
  if (app) return app;
  const existing = getApps();
  if (existing.length > 0) {
    app = existing[0]!;
    return app;
  }
  // .env stores the private key with literal "\n" sequences (standard for
  // service-account JSON pasted into a single-line env var) — un-escape them.
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY!.replace(/\\n/g, "\n");
  app = initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey,
    }),
  });
  return app;
}

/**
 * Push a notification to every device token registered for `userId`. Never
 * throws — send failures are logged, and tokens FCM reports as
 * invalid/unregistered/not-found are deleted so they stop being retried.
 */
export async function sendPushToUser(
  userId: string,
  payload: { title: string; body: string; type: string },
): Promise<void> {
  const fcmApp = getFirebaseApp();
  if (!fcmApp) {
    logger.debug("skipped — Firebase admin credentials not configured");
    return;
  }

  const tokens = await prisma.pushToken.findMany({ where: { userId }, select: { id: true, token: true } });
  if (tokens.length === 0) return;

  const messaging = getMessaging(fcmApp);
  const results = await Promise.allSettled(
    tokens.map((t) =>
      // A `notification` payload makes the FCM SDK render this itself when the
      // tab is backgrounded — title and body both, no code of ours involved.
      // The service worker deliberately registers NO onBackgroundMessage
      // handler (see public/firebase-messaging-sw.js): the SDK runs both the
      // auto-display and the handler, so having both is what double-fired every
      // push. Keeping the render inside the SDK also means a stale cached
      // service worker still shows correct content, which a data-only payload
      // could not — it left the render to worker code that may be out of date.
      messaging.send({
        token: t.token,
        notification: { title: payload.title, body: payload.body },
        data: { type: payload.type },
        webpush: {
          fcmOptions: { link: "/notifications" },
          notification: { icon: "/icon-192.png" },
        },
      }),
    ),
  );

  const staleIds: string[] = [];
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      // firebase-admin's FirebaseError puts the code directly on `.code`
      // (e.g. "messaging/registration-token-not-registered"), not nested.
      const code = (result.reason as { code?: string })?.code ?? "unknown";

      if (DEAD_TOKEN_CODES.some((dead) => code.includes(dead))) {
        staleIds.push(tokens[i]!.id);
      } else if (code.includes("invalid-argument")) {
        // Deliberately NOT pruned. FCM returns invalid-argument for a
        // malformed *payload* as well as a bad token — pruning on it meant one
        // bad payload would delete every user's token on the first send, and
        // silently force the whole company to re-enable push. A payload bug is
        // ours and affects everyone, so make it loud and keep the token.
        logger.error(
          `send rejected as invalid-argument (likely a malformed payload, NOT a dead token) — token ${tokens[i]!.id} kept`,
          { code },
        );
      } else {
        logger.warn(`send failed for token ${tokens[i]!.id}`, { code });
      }
    }
  });

  if (staleIds.length > 0) {
    await prisma.pushToken.deleteMany({ where: { id: { in: staleIds } } });
    logger.info(`pruned ${staleIds.length} stale token(s) for user=${userId}`);
  }

  logger.debug(`sent to ${tokens.length - staleIds.length}/${tokens.length} token(s) for user=${userId}`);
}
