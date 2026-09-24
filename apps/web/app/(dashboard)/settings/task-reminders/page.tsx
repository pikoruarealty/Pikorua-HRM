import { getSession } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import { TaskReminderConfigScreen } from "@/components/settings/task-reminder-config-screen";

export default async function TaskReminderSettingsPage() {
  const session = await getSession();
  return <TaskReminderConfigScreen canEdit={isAdmin(session!.role)} />;
}
