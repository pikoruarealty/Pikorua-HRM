import type { Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { createLogger } from "@/lib/log";

// Cross-cutting audit trail (production hardening, 2026-07-15). Any route
// that mutates financial or sensitive data calls `audit()` after the
// mutation succeeds. Convention for `action`: "<entity>.<verb>", e.g.
// "payslip.generate", "attendance.approve", "auth.login_failed".
//
// Deliberately fire-and-safe: an audit-write failure is logged to the server
// console but NEVER fails the request — the business mutation has already
// committed, and surfacing a 500 for a logging problem would be worse than a
// gap in the trail (the console error keeps it observable).

export type AuditEntry = {
  action: string;
  actorUserId?: string | null;
  actorRole?: Role | null;
  entityType?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
  ip?: string | null;
};

const logger = createLogger("audit");

export async function audit(entry: AuditEntry): Promise<void> {
  // Verbose logging (2026-07-15): every audited mutation also gets a console
  // line, so the full sensitive-mutation history is visible in server logs
  // even before opening the /audit viewer.
  logger.info(
    `${entry.action} actor=${entry.actorUserId ?? "anonymous"}${
      entry.entityType ? ` entity=${entry.entityType}:${entry.entityId ?? "?"}` : ""
    }`,
    entry.metadata,
  );
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        actorUserId: entry.actorUserId ?? null,
        actorRole: entry.actorRole ?? null,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        metadata: entry.metadata,
        ip: entry.ip ?? null,
      },
    });
  } catch (err) {
    console.error(`[audit] failed to record "${entry.action}":`, err);
  }
}

/** Best-effort client IP for audit rows / rate limiting. Trusts the first
 *  x-forwarded-for hop — fine behind our own reverse proxy on the single-VM
 *  deployment; revisit if the proxy topology changes. */
export function clientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip");
}
