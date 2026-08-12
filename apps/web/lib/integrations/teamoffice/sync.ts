// TeamOffice polling sync (2026-08-12, Phase 28). Orchestrates one run of the
// incremental poll: read the cursor, pull new punches, ingest them
// idempotently, then reconcile only the (deviceUid, date) pairs this run
// actually touched.

import { prisma } from "@/lib/db/prisma";
import { createLogger } from "@/lib/log";
import { dateOnly } from "@/lib/attendance/time";
import { downloadLastPunchData } from "@/lib/integrations/teamoffice/client";
import { reconcileEmployeeDay, type ReconcileOutcome } from "@/lib/integrations/teamoffice/reconcile";

const logger = createLogger("teamoffice");

// No vendor-documented "everything since the start" sentinel for LastRecord —
// flagged assumption. Seed with the current month + id 0 (format MMyyyy$ID,
// confirmed from the vendor doc's own examples) so the first-ever run only
// pulls this month forward, not the account's full history.
function initialCursorValue(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `${mm}${now.getFullYear()}$0`;
}

async function getOrCreateCursor() {
  const existing = await prisma.deviceSyncCursor.findFirst();
  if (existing) return existing;
  return prisma.deviceSyncCursor.create({ data: { lastRecord: initialCursorValue() } });
}

export type DeviceSyncResult = {
  punchesFetched: number;
  punchesIngested: number;
  daysReconciled: number;
  outcomes: ReconcileOutcome[];
};

export async function runDeviceSync(): Promise<DeviceSyncResult> {
  const cursor = await getOrCreateCursor();
  const lastRecord = cursor.lastRecord ?? initialCursorValue();

  const { punches, maxRecord } = await downloadLastPunchData(lastRecord);
  logger.info("polled TeamOffice", { punchesFetched: punches.length, lastRecord, maxRecord });

  let punchesIngested = 0;
  if (punches.length > 0) {
    const rows = punches.map((p) => ({
      deviceUid: p.empcode,
      punchTime: p.punchTime,
      dedupKey: `${p.empcode}:${p.punchTime.toISOString()}`,
    }));

    const ingestResult = await prisma.devicePunchRaw.createMany({
      data: rows,
      skipDuplicates: true,
    });
    punchesIngested = ingestResult.count;

    if (maxRecord) {
      await prisma.deviceSyncCursor.update({ where: { id: cursor.id }, data: { lastRecord: maxRecord } });
    }
  }

  // Sweep every (deviceUid, date) pair that still has an unreconciled punch —
  // not just the ones touched by punches fetched THIS run. A punch nearly
  // always arrives before its Empcode gets mapped to an Employee (that's the
  // whole point of the unmatched/suggest screen), and a mapping change alone
  // used to trigger nothing — only a brand-new punch for that same day did,
  // which could mean the backlog never got picked up. reconcileEmployeeDay is
  // cheap and returns "unmapped" without writing anything for an Empcode
  // that's still unassigned, so re-sweeping the full backlog every 2 minutes
  // is safe and makes a fresh mapping take effect on the very next poll.
  const pending = await prisma.devicePunchRaw.findMany({
    where: { reconciledAt: null },
    select: { deviceUid: true, punchTime: true },
  });
  const touched = new Map<string, { deviceUid: string; date: Date }>();
  for (const p of pending) {
    const day = dateOnly(p.punchTime);
    const key = `${p.deviceUid}:${day.toISOString()}`;
    touched.set(key, { deviceUid: p.deviceUid, date: day });
  }

  const outcomes: ReconcileOutcome[] = [];
  for (const { deviceUid, date } of touched.values()) {
    try {
      outcomes.push(await reconcileEmployeeDay(deviceUid, date));
    } catch (err) {
      logger.error("reconciliation failed", {
        deviceUid,
        date,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    punchesFetched: punches.length,
    punchesIngested,
    daysReconciled: outcomes.filter((o) => o.status === "reconciled").length,
    outcomes,
  };
}
