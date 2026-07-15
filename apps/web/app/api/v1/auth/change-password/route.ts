import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession, verifyPassword, hashPassword } from "@/lib/auth";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { checkPasswordStrength } from "@/lib/security/password-policy";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { audit, clientIp } from "@/lib/audit";

// POST /api/v1/auth/change-password — any authenticated user, self only.
// { current_password, new_password }. Requires the current password (so a
// hijacked session can't silently take over the account) and enforces the
// password policy. Production hardening, 2026-07-15: employees are provisioned
// with a server-generated temporary password at creation; this is the
// self-service way to rotate it.
const bodySchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(1),
});

const LIMIT = { max: 5, windowMs: 15 * 60 * 1000 };

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return failFor(ErrorCode.UNAUTHENTICATED);
  }

  const limit = checkRateLimit(`change-password:${session.userId}`, LIMIT);
  if (!limit.allowed) {
    const res = fail("RATE_LIMITED", "Too many attempts. Try again later.", 429);
    res.headers.set("Retry-After", String(limit.retryAfterSeconds));
    return res;
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return fail(
      ErrorCode.VALIDATION,
      "current_password and new_password are required.",
      422,
    );
  }

  const strength = checkPasswordStrength(parsed.data.new_password);
  if (!strength.ok) {
    return fail(ErrorCode.VALIDATION, strength.reason, 422);
  }

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) {
    return failFor(ErrorCode.UNAUTHENTICATED);
  }

  if (!(await verifyPassword(parsed.data.current_password, user.passwordHash))) {
    return fail(ErrorCode.UNAUTHENTICATED, "Current password is incorrect.", 401);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(parsed.data.new_password) },
  });

  await audit({
    action: "auth.change_password",
    actorUserId: user.id,
    actorRole: user.role,
    entityType: "user",
    entityId: user.id,
    ip: clientIp(req),
  });

  return ok({ changed: true });
}
