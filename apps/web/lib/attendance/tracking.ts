// 2026-09-30 (owner request: "remove admin attendance totally"). The Admin
// account runs the system; it does not clock in, is not on the biometric
// device and has no attendance to review. Daily Planning / My Tasks already
// redirect Admin away and the daily overview/task-progress already filter
// them out — but the monthly table, the profile panel, manual entry and the
// device sync still treated Admin as a tracked employee, which made an
// administrator who never clocks in read as "absent every working day".
//
// One list, used everywhere, so the rule can't drift per call site. HR is
// deliberately NOT exempt: HR clocks in and works like any other employee.
//
// Kept free of imports on purpose (no @/lib/rbac — that pulls Prisma in) so
// client components can use it too.
export const ATTENDANCE_EXEMPT_ROLES: string[] = ["admin"];

export function isAttendanceExemptRole(role: string | null | undefined): boolean {
  return role != null && ATTENDANCE_EXEMPT_ROLES.includes(role);
}

export const ATTENDANCE_EXEMPT_MESSAGE = "Attendance isn't tracked for Admin accounts.";
