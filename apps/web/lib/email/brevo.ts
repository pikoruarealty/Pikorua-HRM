// Email infrastructure (added 2026-07-16, feature: forgot/reset password).
//
// Thin wrapper over Brevo's transactional email REST API. Uses the global
// `fetch` (Node 18+ / Next.js runtime) so no SDK dependency is added — keeps
// `apps/web/package.json` (a shared file) untouched, same pattern as
// lib/ai/groq.ts.
//
// Config via env (see .env.example):
//   BREVO_API_KEY      — required to actually send; missing/placeholder
//                         degrades to a no-op (logged at debug), same posture
//                         as the optional Firebase/Groq config.
//   BREVO_SENDER_EMAIL — must be a verified sender in the Brevo account.
//   BREVO_SENDER_NAME  — display name for the "From" header.

import { createLogger } from "@/lib/log";

const BREVO_SEND_URL = "https://api.brevo.com/v3/smtp/email";
const DEFAULT_SENDER_EMAIL = "pikoruaweb@gmail.com";
const DEFAULT_SENDER_NAME = "PIKORUA";

const logger = createLogger("email");

export class BrevoError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "BrevoError";
  }
}

export type SendEmailOptions = {
  to: string;
  subject: string;
  html: string;
};

function isConfigured(apiKey: string | undefined): apiKey is string {
  return typeof apiKey === "string" && apiKey.trim().length > 0;
}

/**
 * Send a transactional email via Brevo. Degrades gracefully: if
 * BREVO_API_KEY isn't configured, logs at debug and returns without sending
 * or throwing — callers must not depend on delivery for control flow (the
 * forgot-password route in particular must behave identically whether or not
 * email is configured, to avoid leaking account existence via error
 * behavior).
 */
export async function sendEmail(opts: SendEmailOptions): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!isConfigured(apiKey)) {
    logger.debug("BREVO_API_KEY not configured; skipping send", { to: opts.to });
    return;
  }

  const senderEmail = process.env.BREVO_SENDER_EMAIL || DEFAULT_SENDER_EMAIL;
  const senderName = process.env.BREVO_SENDER_NAME || DEFAULT_SENDER_NAME;

  let res: Response;
  try {
    res = await fetch(BREVO_SEND_URL, {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        sender: { email: senderEmail, name: senderName },
        to: [{ email: opts.to }],
        subject: opts.subject,
        htmlContent: opts.html,
      }),
    });
  } catch (err) {
    throw new BrevoError(
      `Brevo request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new BrevoError(`Brevo API error ${res.status}: ${detail.slice(0, 500)}`, res.status);
  }

  logger.debug("email sent", { to: opts.to, subject: opts.subject });
}
