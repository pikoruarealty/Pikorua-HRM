import { hasOpenSessionToday } from "@/lib/attendance/sessions";

// Attendance helper consumed by the work-item routes to gate task modification
// on the assignee's own clock-in state.
//
// "Clocked in" means an OPEN session right now, not "clocked in at some point
// today and hasn't finished". Since 2026-08-11 an employee can clock out and
// back in freely, and the rule the owner asked for is exactly this: you may
// clock in again whenever you like, but while you are clocked out you cannot
// log progress.
export async function isClockedInNow(employeeId: string): Promise<boolean> {
  return hasOpenSessionToday(employeeId);
}
