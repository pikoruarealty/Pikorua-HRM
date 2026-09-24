import { getSession } from "@/lib/auth";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { sendTestPush } from "@/lib/notifications/fcm";

// POST /api/v1/notifications/push-test — self-only. Sends a real push to the
// caller's own registered devices and reports what FCM answered, per device.
// Writes no in-app notification row: it exists to test the OS-popup path, and
// a test shouldn't leave clutter in the notifications list.
export async function POST() {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);

  return ok(await sendTestPush(session.userId));
}
