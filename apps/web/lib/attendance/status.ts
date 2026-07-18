import { prisma } from "@/lib/db/prisma";
import { todayDateOnly } from "@/lib/attendance/time";

// Track A helper, consumed by Track B's work-item routes to gate task
// modification on the assignee's own clock-in state (flagged — new cross-
// track coupling, attendance -> work-items).
export async function isClockedInNow(employeeId: string): Promise<boolean> {
  const record = await prisma.attendanceRecord.findUnique({
    where: { employeeId_date: { employeeId, date: todayDateOnly() } },
  });
  return !!record?.clockInRaw && !record?.clockOutRaw;
}
