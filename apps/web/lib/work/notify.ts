import { prisma } from "@/lib/db/prisma";
import { pushNotification } from "@/lib/notifications/push";

// Notification helpers for the tiered-review flow (Pillar 2, 2026-08-08).
// Kept out of lib/work/review.ts so that module stays pure and unit-testable
// without a database.
//
// Every function here is best-effort: a notification failure must never fail
// the mutation that triggered it (the task is already submitted/accepted by the
// time we get here), so each swallows its own errors after logging.

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
    console.error(`[work-review] failed to notify employee=${employeeId} type=${type}:`, err);
  }
}

/** Tell the project lead that a threshold-crossing task is waiting on them. */
export async function notifyReviewSubmitted(
  projectLeadId: string,
  assigneeName: string,
  taskTitle: string,
): Promise<void> {
  await notifyEmployee(
    projectLeadId,
    "task_review_pending",
    `${assigneeName} submitted "${taskTitle}" for review.`,
    "Task awaiting review",
  );
}

/** Tell the assignee their task was accepted, and for how many points. */
export async function notifyReviewAccepted(
  assigneeId: string,
  taskTitle: string,
  points: number,
  note: string | null,
): Promise<void> {
  await notifyEmployee(
    assigneeId,
    "task_review_accepted",
    `"${taskTitle}" was accepted — ${points} pts credited.${note ? ` ${note}` : ""}`,
    "Task accepted",
  );
}

/** Tell the assignee their task came back with the Lead's reason. */
export async function notifyReviewRejected(
  assigneeId: string,
  taskTitle: string,
  note: string,
): Promise<void> {
  await notifyEmployee(
    assigneeId,
    "task_review_rejected",
    `"${taskTitle}" was sent back for more work — ${note}`,
    "Task sent back",
  );
}
