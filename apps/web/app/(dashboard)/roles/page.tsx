import { getSession } from "@/lib/auth";
import { Role } from "@/lib/rbac";
import { RolesScreen } from "@/components/roles/roles-screen";

// Admin-only screen (2026-08-13). Roles moved from a fixed Prisma enum to a
// DB-backed table so a new role (e.g. "cto") can be added here without a
// schema migration — see /api/v1/roles and lib/rbac's refreshRoleRegistry.
export default async function RolesPage() {
  const session = await getSession();
  if (session?.role !== Role.admin) {
    return (
      <p className="text-sm text-muted-foreground">
        Role configuration is only available to Admins.
      </p>
    );
  }

  return <RolesScreen />;
}
