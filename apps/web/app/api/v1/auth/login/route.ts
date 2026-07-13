import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { verifyPassword, createSession } from "@/lib/auth";
import { ok, fail, failFor, ErrorCode } from "@/lib/api/response";

// SHARED (Phase 0). POST /api/v1/auth/login  { email, password }
const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

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
  const user = await prisma.user.findUnique({
    where: { email },
    include: { employee: { select: { id: true, fullName: true } } },
  });

  // Same response whether the email is unknown or the password is wrong, to
  // avoid leaking which emails exist.
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return fail(ErrorCode.UNAUTHENTICATED, "Invalid email or password.", 401);
  }

  await createSession({
    userId: user.id,
    role: user.role,
    employeeId: user.employeeId,
  });

  return ok({
    id: user.id,
    email: user.email,
    role: user.role,
    employeeId: user.employeeId,
    fullName: user.employee?.fullName ?? null,
  });
}
