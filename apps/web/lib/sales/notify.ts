import { prisma } from "@/lib/db/prisma";
import { pushNotification } from "@/lib/notifications/push";

// Notification helpers for the offline-claim flow (2026-08-10). Same
// best-effort contract as lib/work/notify.ts: a notification failure must never
// fail the mutation that triggered it, so each function swallows its own errors
// after logging.

async function notifyEmployee(
  employeeId: string,
  type: string,
  message: string,
  title?: string,
): Promise<void> {
  try {
    const user = await prisma.user.findUnique({ where: { employeeId } });
    if (!user) return; // employee without a login — nothing to notify
    await pushNotification(user.id, type, message, title);
  } catch (err) {
    console.error(`[sales-notify] failed to notify employee=${employeeId} type=${type}:`, err);
  }
}

/**
 * Tell whoever can act on it that a rep has filed an offline-call claim: the
 * lead of every team the rep belongs to, plus Admin/HR as the backstop. Without
 * this the claim sits pending forever and the rep's number silently undercounts
 * — the exact problem the feature exists to fix.
 */
export async function notifyOfflineClaimSubmitted(
  claimantId: string,
  claimantName: string,
  calls: number,
  dateStr: string,
): Promise<void> {
  try {
    const [rep, finance] = await Promise.all([
      prisma.employee.findUnique({
        where: { id: claimantId },
        select: { team: { select: { teamLeadId: true } } },
      }),
      prisma.employee.findMany({
        where: { status: "active", role: { in: ["admin", "hr"] } },
        select: { id: true },
      }),
    ]);

    const targets = new Set<string>();
    if (rep?.team?.teamLeadId && rep.team.teamLeadId !== claimantId) {
      targets.add(rep.team.teamLeadId);
    }
    // Admin/HR always get it too: a rep whose team has no lead set must not end
    // up with an unreviewable claim.
    for (const f of finance) if (f.id !== claimantId) targets.add(f.id);

    for (const id of targets) {
      await notifyEmployee(
        id,
        "sales_offline_claim_pending",
        `${claimantName} claimed ${calls} offline calls for ${dateStr}.`,
        "Offline calls to review",
      );
    }
  } catch (err) {
    console.error("[sales-notify] failed to notify claim reviewers:", err);
  }
}

export async function notifyOfflineClaimReviewed(
  claimantId: string,
  approved: boolean,
  calls: number,
  dateStr: string,
  note: string | null,
): Promise<void> {
  await notifyEmployee(
    claimantId,
    approved ? "sales_offline_claim_approved" : "sales_offline_claim_rejected",
    approved
      ? `Your ${calls} offline calls for ${dateStr} were approved.${note ? ` ${note}` : ""}`
      : `Your ${calls} offline calls for ${dateStr} were not approved — ${note ?? "no reason given"}`,
    approved ? "Offline calls approved" : "Offline calls declined",
  );
}
