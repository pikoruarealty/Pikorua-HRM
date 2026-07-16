import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { ok, failFor, ErrorCode } from "@/lib/api/response";

// FCM web push (added 2026-07-15). POST/DELETE — self-only: a browser
// registers/unregisters its own FCM token against the logged-in user. No
// route reads or writes another user's tokens; `sendPushToUser` (server-side
// only) is the sole reader, scoped by userId.

const tokenSchema = z.object({ token: z.string().min(20) });

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failFor(ErrorCode.VALIDATION, "Request body must be valid JSON.");
  }
  const parsed = tokenSchema.safeParse(body);
  if (!parsed.success) return failFor(ErrorCode.VALIDATION, "token is required.");

  // Upsert on the unique token: if this exact token was previously
  // registered to a different account (e.g. a shared/kiosk browser where a
  // different user logged in), re-point it to the current user rather than
  // erroring — a stale cross-account mapping is a worse outcome than a rebind.
  await prisma.pushToken.upsert({
    where: { token: parsed.data.token },
    update: { userId: session.userId },
    create: { userId: session.userId, token: parsed.data.token },
  });

  return ok({ registered: true }, 201);
}

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failFor(ErrorCode.VALIDATION, "Request body must be valid JSON.");
  }
  const parsed = tokenSchema.safeParse(body);
  if (!parsed.success) return failFor(ErrorCode.VALIDATION, "token is required.");

  // Scoped to the caller's own userId — deleting someone else's token by
  // guessing its value is a no-op (deleteMany with a non-matching where).
  await prisma.pushToken.deleteMany({
    where: { token: parsed.data.token, userId: session.userId },
  });

  return ok({ unregistered: true });
}
