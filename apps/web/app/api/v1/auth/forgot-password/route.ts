import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { ok, fail } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { audit, clientIp } from "@/lib/audit";
import { sendEmail } from "@/lib/email/brevo";
import { passwordResetEmailHtml } from "@/lib/email/templates/password-reset";
import { createLogger } from "@/lib/log";

// POST /api/v1/auth/forgot-password — public, unauthenticated.
// { email } -> always the same generic response, regardless of whether the
// account exists, so a caller can't enumerate registered emails. If the
// account exists, emails a single-use, 15-minute reset link via Brevo.

const logger = createLogger("auth");

const bodySchema = z.object({
  email: z.string().email(),
});

const LIMIT = { max: 5, windowMs: 15 * 60 * 1000 };
const TOKEN_TTL_MS = 15 * 60 * 1000;

const GENERIC_MESSAGE =
  "If an account exists for that email, we've sent a password reset link.";

function normalizedAppBaseUrl(): string {
  const raw = (process.env.APP_BASE_URL || "http://localhost:3000").trim();
  return /^https?:\/\//i.test(raw) ? raw.replace(/\/+$/, "") : `https://${raw.replace(/\/+$/, "")}`;
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  const limit = checkRateLimit(`forgot-password:${ip ?? "unknown"}`, LIMIT);
  if (!limit.allowed) {
    const res = fail("RATE_LIMITED", "Too many attempts. Try again later.", 429);
    res.headers.set("Retry-After", String(limit.retryAfterSeconds));
    return res;
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return fail("VALIDATION", "A valid email is required.", 422);
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
  });

  if (user) {
    await prisma.passwordResetToken.deleteMany({
      where: { userId: user.id, usedAt: null },
    });

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      },
    });

    const resetUrl = `${normalizedAppBaseUrl()}/reset-password?token=${rawToken}`;
    try {
      await sendEmail({
        to: user.email,
        subject: "Reset your Pikorua HRM password",
        html: passwordResetEmailHtml({ resetUrl, expiresInMinutes: 15 }),
      });
    } catch (err) {
      // Never let a send failure change the response shape (would leak
      // account existence); log only.
      logger.error("failed to send password reset email", {
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await audit({
      action: "auth.forgot_password_requested",
      actorUserId: user.id,
      actorRole: user.role,
      entityType: "user",
      entityId: user.id,
      ip,
    });
  }

  return ok({ sent: true, message: GENERIC_MESSAGE });
}
