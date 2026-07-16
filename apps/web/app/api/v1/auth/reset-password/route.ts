import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { hashPassword } from "@/lib/auth";
import { ok, fail } from "@/lib/api/response";
import { checkPasswordStrength } from "@/lib/security/password-policy";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { audit, clientIp } from "@/lib/audit";

// POST /api/v1/auth/reset-password — public, unauthenticated.
// { token, new_password } -> consumes a single-use forgot-password token.
// Bumps tokenVersion (revokes every outstanding session) and does NOT
// auto-login — the user signs in fresh at /login with the new password.

const bodySchema = z.object({
  token: z.string().min(1),
  new_password: z.string().min(1),
});

const LIMIT = { max: 10, windowMs: 15 * 60 * 1000 };

const INVALID_MESSAGE = "This reset link is invalid or has expired.";

export async function POST(req: Request) {
  const ip = clientIp(req);
  const limit = checkRateLimit(`reset-password:${ip ?? "unknown"}`, LIMIT);
  if (!limit.allowed) {
    const res = fail("RATE_LIMITED", "Too many attempts. Try again later.", 429);
    res.headers.set("Retry-After", String(limit.retryAfterSeconds));
    return res;
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return fail("VALIDATION", "token and new_password are required.", 422);
  }

  const strength = checkPasswordStrength(parsed.data.new_password);
  if (!strength.ok) {
    return fail("VALIDATION", strength.reason, 422);
  }

  const tokenHash = crypto.createHash("sha256").update(parsed.data.token).digest("hex");
  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (
    !resetToken ||
    resetToken.usedAt !== null ||
    resetToken.expiresAt.getTime() <= Date.now()
  ) {
    return fail("VALIDATION", INVALID_MESSAGE, 422);
  }

  const newPasswordHash = await hashPassword(parsed.data.new_password);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: resetToken.userId },
      data: {
        passwordHash: newPasswordHash,
        tokenVersion: { increment: 1 },
        mustChangePassword: false,
      },
    }),
    prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { usedAt: new Date() },
    }),
  ]);

  await audit({
    action: "auth.password_reset",
    actorUserId: resetToken.userId,
    actorRole: resetToken.user.role,
    entityType: "user",
    entityId: resetToken.userId,
    ip,
  });

  return ok({ reset: true });
}
