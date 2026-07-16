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

// Golden-rule guard (2026-07-16): the audited metadata can contain salary and
// net-pay figures (employee.update base_salary_*, payslip.generate net_pay,
// reimbursement/deduction totals, request amounts). The `audit_logs` DB row is
// Admin-only, but the console/stdout stream that logger.info writes to is NOT
// access-controlled (it flows to log aggregation ops can read). So the console
// line gets financial VALUES redacted; the full detail is preserved only in the
// access-controlled DB row below.
const SENSITIVE_METADATA_KEY = /salary|net_?pay|deduction|reimbursement|amount|incentive|bonus/i;

function redactMetadataForLog(
  metadata: Prisma.InputJsonValue | undefined,
): Prisma.InputJsonValue | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return metadata;
  }
  const out: Record<string, Prisma.InputJsonValue> = {};
  for (const [key, value] of Object.entries(metadata as Record<string, Prisma.InputJsonValue>)) {
    out[key] = SENSITIVE_METADATA_KEY.test(key) ? "[redacted]" : value;
  }
  return out;
}

export async function audit(entry: AuditEntry): Promise<void> {
  // Verbose logging (2026-07-15): every audited mutation also gets a console
  // line, so the full sensitive-mutation history is visible in server logs
  // even before opening the /audit viewer — with financial values redacted
  // (see redactMetadataForLog above).
  logger.info(
    `${entry.action} actor=${entry.actorUserId ?? "anonymous"}${
      entry.entityType ? ` entity=${entry.entityType}:${entry.entityId ?? "?"}` : ""
    }`,
    redactMetadataForLog(entry.metadata),
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
