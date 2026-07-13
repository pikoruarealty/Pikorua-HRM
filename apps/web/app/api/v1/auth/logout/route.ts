import { destroySession } from "@/lib/auth";
import { ok } from "@/lib/api/response";

// SHARED (Phase 0). POST /api/v1/auth/logout
export async function POST() {
  destroySession();
  return ok({ success: true });
}
