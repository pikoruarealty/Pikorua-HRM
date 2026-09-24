import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { fcmConfigured } from "@/lib/notifications/fcm";

// GET /api/v1/notifications/push-status[?token=...] — self-only. The server's
// side of "why don't I get popups": can this deployment send at all, how many
// devices does the caller have registered, and (when the browser passes its
// stored token) is THIS device actually among them. The Settings toggle reads
// "On" from localStorage alone, so without this a server-side pruned/lost
// token looked identical to a working one.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  const token = new URL(req.url).searchParams.get("token");
  const [registeredTokens, thisDevice] = await Promise.all([
    prisma.pushToken.count({ where: { userId: session.userId } }),
    token
      ? prisma.pushToken.findFirst({ where: { userId: session.userId, token }, select: { id: true } })
      : Promise.resolve(null),
  ]);

  return ok({
    serverConfigured: fcmConfigured(),
    registeredTokens,
    thisDeviceRegistered: token ? thisDevice !== null : null,
  });
}
