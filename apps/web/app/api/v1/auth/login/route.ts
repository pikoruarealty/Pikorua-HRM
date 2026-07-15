import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { verifyPassword, createSession } from "@/lib/auth";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";
import { checkRateLimit, resetRateLimit } from "@/lib/security/rate-limit";
import { audit, clientIp } from "@/lib/audit";

// SHARED (Phase 0). POST /api/v1/auth/login  { email, password }
//
// Brute-force protection (production hardening, 2026-07-15): attempts are
// rate-limited per (ip, email) and per ip. Limits reset on successful login.
// Failed/blocked/successful attempts all land in the audit trail.
const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const PER_ACCOUNT = { max: 5, windowMs: 15 * 60 * 1000 }; // 5 tries / 15 min / (ip, email)
const PER_IP = { max: 20, windowMs: 15 * 60 * 1000 }; // 20 tries / 15 min / ip

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failFor(ErrorCode.VALIDATION, "Request body must be valid JSON.");
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return failFor(ErrorCode.VALIDATION, "email and password are required.");
  }

  const { email, password } = parsed.data;
  const ip = clientIp(req) ?? "unknown";
  const accountKey = `login:${ip}:${email.toLowerCase()}`;
  const ipKey = `login-ip:${ip}`;

  const accountLimit = checkRateLimit(accountKey, PER_ACCOUNT);
  const ipLimit = checkRateLimit(ipKey, PER_IP);
  if (!accountLimit.allowed || !ipLimit.allowed) {
    const retryAfter = Math.max(accountLimit.retryAfterSeconds, ipLimit.retryAfterSeconds);
    await audit({
      action: "auth.login_rate_limited",
      metadata: { email },
      ip,
    });
    const res = fail("RATE_LIMITED", "Too many login attempts. Try again later.", 429);
    res.headers.set("Retry-After", String(retryAfter));
    return res;
  }

  const user = await prisma.user.findUnique({
    where: { email },
    include: { employee: { select: { id: true, fullName: true } } },
  });

  // Same response whether the email is unknown or the password is wrong, to
  // avoid leaking which emails exist.
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    await audit({
      action: "auth.login_failed",
      metadata: { email },
      ip,
    });
    return fail(ErrorCode.UNAUTHENTICATED, "Invalid email or password.", 401);
  }

  await createSession({
    userId: user.id,
    role: user.role,
    employeeId: user.employeeId,
  });

  resetRateLimit(accountKey);
  await audit({
    action: "auth.login",
    actorUserId: user.id,
    actorRole: user.role,
    entityType: "user",
    entityId: user.id,
    ip,
  });

  return ok({
    id: user.id,
    email: user.email,
    role: user.role,
    employeeId: user.employeeId,
    fullName: user.employee?.fullName ?? null,
  });
}
