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

  if (punches.length === 0) {
    return { punchesFetched: 0, punchesIngested: 0, daysReconciled: 0, outcomes: [] };
  }

  const rows = punches.map((p) => ({
    deviceUid: p.empcode,
    punchTime: p.punchTime,
    dedupKey: `${p.empcode}:${p.punchTime.toISOString()}`,
  }));

  const ingestResult = await prisma.devicePunchRaw.createMany({
    data: rows,
    skipDuplicates: true,
  });

  if (maxRecord) {
    await prisma.deviceSyncCursor.update({ where: { id: cursor.id }, data: { lastRecord: maxRecord } });
  }

  // Reconcile only the (deviceUid, date) pairs touched this run.
  const touched = new Map<string, { deviceUid: string; date: Date }>();
  for (const p of punches) {
    const day = dateOnly(p.punchTime);
    const key = `${p.empcode}:${day.toISOString()}`;
    touched.set(key, { deviceUid: p.empcode, date: day });
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
    punchesIngested: ingestResult.count,
    daysReconciled: outcomes.filter((o) => o.status === "reconciled").length,
    outcomes,
  };
}
