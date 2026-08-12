// TeamOffice reconciliation (2026-08-12, Phase 28). Turns raw device_punch_raw
// rows into attendance_sessions rows, per (deviceUid, date) pair. Reuses the
// same session arithmetic the manual clock-in/out routes use
// (lib/attendance/sessions.ts) — cross-module helper stability rule.
//
// Source-of-truth guard (owner-locked decision), checked BEFORE any write:
//  - a day already work_location=wfh is skipped entirely — WFH is
//    manual-authoritative, never overwritten by a device punch.
//  - a day already approval_status=approved with source still manual is also
//    skipped — an approved manual day isn't silently clobbered.
// Both checks read attendance_records.work_location/approval_status/source,
// which is enough on its own since manual WFH clock-in never writes
// device_punch_raw rows.

import { AttendanceApprovalStatus, AttendanceSource, WorkLocation } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { createLogger } from "@/lib/log";
import { audit } from "@/lib/audit";
import { dateOnly, isImplausibleDuration } from "@/lib/attendance/time";
import { sessionBounds, summariseSessions, type SessionSpan } from "@/lib/attendance/sessions";

const logger = createLogger("teamoffice");

export type ReconcileOutcome =
  | { status: "reconciled"; employeeId: string; sessionsCreated: number }
  | { status: "skipped_wfh"; deviceUid: string }
  | { status: "skipped_already_approved"; deviceUid: string }
  | { status: "unmapped"; deviceUid: string }
  | { status: "no_unreconciled_punches"; deviceUid: string };

/** The source-of-truth guard's decision for an existing AttendanceRecord,
 *  extracted as a pure function so it's testable without a database. */
export type GuardableRecord = {
  workLocation: WorkLocation;
  approvalStatus: AttendanceApprovalStatus;
  source: AttendanceSource;
} | null;

export function guardDecision(existing: GuardableRecord): "skip_wfh" | "skip_already_approved" | "proceed" {
  if (existing?.workLocation === WorkLocation.wfh) return "skip_wfh";
  if (
    existing?.approvalStatus === AttendanceApprovalStatus.approved &&
    existing.source !== AttendanceSource.device_sync
  ) {
    return "skip_already_approved";
  }
  return "proceed";
}

/** Pair a day's chronologically-sorted punches into open/closed sessions.
 *  Odd punch = in, even = out (no reliable IN/OUT flag from the vendor's
 *  incremental endpoint) — an odd count leaves the last session open, which
 *  is exactly what we want for a live "clocked in now" dashboard read. */
export function pairPunches(punches: { punchTime: Date }[]): SessionSpan[] {
  const sorted = [...punches].sort((a, b) => a.punchTime.getTime() - b.punchTime.getTime());
  const spans: SessionSpan[] = [];
  for (let i = 0; i < sorted.length; i += 2) {
    spans.push({ clockIn: sorted[i].punchTime, clockOut: sorted[i + 1]?.punchTime ?? null });
  }
  return spans;
}

/** Reconcile one employee's one day's worth of raw punches. Call once per
 *  (deviceUid, date) pair touched by a sync run. */
export async function reconcileEmployeeDay(deviceUid: string, date: Date): Promise<ReconcileOutcome> {
  const day = dateOnly(date);
  const nextDay = new Date(day.getTime() + 24 * 3600 * 1000);

  // The FULL day's punch history, not just this run's newly-arrived rows —
  // pairing must always run over the complete, correctly-ordered set. A punch
  // that lands in a later sync cycle (the near-universal case: an evening
  // clock-out ingested in a different 2-minute poll than the morning
  // clock-in) would otherwise be paired against nothing and misread as a
  // fresh, unrelated clock-in. DevicePunchRaw rows are kept forever after
  // reconciliation (schema: "audit trail + replay safety"), so re-reading the
  // whole day here is safe and cheap.
  const rawPunches = await prisma.devicePunchRaw.findMany({
    where: { deviceUid, punchTime: { gte: day, lt: nextDay } },
    orderBy: { punchTime: "asc" },
  });
  if (rawPunches.length === 0) {
    return { status: "no_unreconciled_punches", deviceUid };
  }
  // Nothing new arrived since the last run for this day — skip redundant work.
  if (rawPunches.every((p) => p.reconciledAt !== null)) {
    return { status: "no_unreconciled_punches", deviceUid };
  }

  const employee = await prisma.employee.findFirst({ where: { deviceUid } });
  if (!employee) {
    logger.info("device punch unmapped, no employee links this Empcode", { deviceUid, date: day });
    return { status: "unmapped", deviceUid };
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId: employee.id, date: day } },
    });

    const decision = guardDecision(existing);
    if (decision === "skip_wfh") {
      logger.info("device punch ignored: employee WFH", { deviceUid, employeeId: employee.id, date: day });
      return { status: "skipped_wfh", deviceUid };
    }
    if (decision === "skip_already_approved") {
      logger.info("device punch ignored: day already approved manually", {
        deviceUid,
        employeeId: employee.id,
        date: day,
      });
      return { status: "skipped_already_approved", deviceUid };
    }

    // Pairing runs over rawPunches (the whole day, chronologically sorted),
    // so this is always the day's complete, correct session set — no merge
    // with whatever happened to survive a prior run is needed.
    const spans = pairPunches(rawPunches);

    const { firstIn, lastOut } = sessionBounds(spans);
    const { totalHours, isHalfDay } = summariseSessions(spans);

    // A day this long is almost certainly a mispaired/misread punch set
    // rather than a real shift (2026-08-12) — takes priority over the usual
    // "fresh reconciliation clears whatever was flagged" rule below, since
    // clearing it here would wave through exactly the bad-data case this
    // check exists to catch.
    const implausible = isImplausibleDuration(totalHours);
    const reviewFields = implausible
      ? {
          flaggedForReview: true,
          flagReason: `Device-synced day totals ${totalHours}h across ${spans.length} session(s), well beyond a normal shift — likely a punch mispairing. Needs manual review via Edit before it can be approved.`,
        }
      : { flaggedForReview: false, flagReason: null };

    const record = existing
      ? await tx.attendanceRecord.update({
          where: { id: existing.id },
          data: {
            clockInRaw: firstIn ?? existing.clockInRaw,
            clockOutRaw: lastOut,
            totalHours,
            isHalfDay,
            source: AttendanceSource.device_sync,
            workLocation: WorkLocation.office,
            // A fresh reconciliation rewrites the whole day from the complete
            // punch set — it supersedes whatever the EOD cleanup cron
            // flagged earlier (e.g. a late punch arriving resolves what
            // looked like a solo reversed punch). If the ambiguity is still
            // there, tonight's cleanup run will re-flag it.
            ...reviewFields,
          },
        })
      : await tx.attendanceRecord.create({
          data: {
            employeeId: employee.id,
            date: day,
            clockInRaw: firstIn,
            clockOutRaw: lastOut,
            totalHours,
            isHalfDay,
            source: AttendanceSource.device_sync,
            workLocation: WorkLocation.office,
            ...(implausible ? reviewFields : {}),
          },
        });

    // Rewrite this day's device_sync sessions from scratch rather than trying
    // to diff — sessions have no natural external identity to upsert against,
    // and rawPunches (now the whole day) is always the authoritative source.
    // Created one at a time (not createMany) so each session's id is known
    // immediately and can be linked back to the exact punch(es) that produced
    // it — a punch pairs with the ONE session it opened or closed, never with
    // whichever session happened to be created last.
    await tx.attendanceSession.deleteMany({
      where: { recordId: record.id, source: AttendanceSource.device_sync },
    });
    for (let i = 0; i < spans.length; i++) {
      const span = spans[i]!;
      const session = await tx.attendanceSession.create({
        data: {
          recordId: record.id,
          clockIn: span.clockIn,
          clockOut: span.clockOut,
          source: AttendanceSource.device_sync,
          workLocation: WorkLocation.office,
        },
      });
      const inPunch = rawPunches[i * 2]!;
      const outPunch = rawPunches[i * 2 + 1];
      await tx.devicePunchRaw.updateMany({
        where: { id: { in: outPunch ? [inPunch.id, outPunch.id] : [inPunch.id] } },
        data: { reconciledAt: new Date(), reconciledSessionId: session.id },
      });
    }

    await audit({
      action: "attendance.device_sync",
      entityType: "attendance_record",
      entityId: record.id,
      metadata: {
        employee_id: employee.id,
        device_uid: deviceUid,
        date: day.toISOString().slice(0, 10),
        sessions_created: spans.length,
      },
    });

    return { status: "reconciled", employeeId: employee.id, sessionsCreated: spans.length };
  });
}
