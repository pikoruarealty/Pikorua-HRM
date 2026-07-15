import { getSession } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/rbac";
import { CalendarScreen } from "@/components/calendar/calendar-screen";

// /calendar — everything with a date in one place (holidays, birthdays,
// anniversaries, meetings, leave), RBAC-scoped by GET /api/v1/calendar.
// Admin/HR can also manage holidays from here.
export default async function CalendarPage() {
  const session = await getSession();
  const canManageHolidays = FINANCE_ROLES.includes(session!.role);
  return <CalendarScreen canManageHolidays={canManageHolidays} />;
}
