import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getSession } from "@/lib/auth";
import { Role } from "@/lib/rbac";
import { ok, failFor, ErrorCode } from "@/lib/api/response";
import { PayslipStatus } from "@prisma/client";
import { audit, clientIp } from "@/lib/audit";

// Admin manual override (2026-07-15). PATCH /api/v1/payslips/:id/unfinalize —
// **Admin only**: finalized → draft, so a payslip finalized with wrong
// numbers can be corrected (delete the draft, fix inputs, regenerate).
// Reason is mandatory and audited.

const schema = z.object({ reason: z.string().min(3, "A reason is required to unfinalize.") });

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return failFor(ErrorCode.UNAUTHENTICATED);
  if (session.role !== Role.admin) return failFor(ErrorCode.FORBIDDEN);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failFor(ErrorCode.VALIDATION, "Request body must be valid JSON.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return failFor(ErrorCode.VALIDATION, parsed.error.issues[0]?.message ?? "Invalid request.");
  }

  const payslip = await prisma.payslip.findUnique({ where: { id: params.id } });
  if (!payslip) return failFor(ErrorCode.NOT_FOUND);
  if (payslip.status !== PayslipStatus.finalized) {
    return failFor(ErrorCode.CONFLICT, "Only finalized payslips can be unfinalized.");
  }

  const updated = await prisma.payslip.update({
    where: { id: params.id },
    data: { status: PayslipStatus.draft },
  });

  await audit({
    action: "payslip.unfinalize",
    actorUserId: session.userId,
    actorRole: session.role,
    entityType: "payslip",
    entityId: params.id,
    metadata: {
      employee_id: payslip.employeeId,
      period: `${payslip.periodYear}-${payslip.periodMonth}`,
      net_pay: Number(payslip.netPay),
      reason: parsed.data.reason,
    },
    ip: clientIp(req),
  });

  return ok(updated);
}
