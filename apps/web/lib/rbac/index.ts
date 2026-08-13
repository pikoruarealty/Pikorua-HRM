import { prisma } from "@/lib/db/prisma";

// SHARED (Phase 0). Role model + guards used by every API route in both tracks.
// Roles are grouped so PRD §3 rules read declaratively.
//
// As of 2026-08-13, roles are no longer a fixed Prisma enum — they live in the
// `roles` DB table (Admin-editable, see /api/v1/roles) so a new role (e.g.
// "cto") can be added from the app without a schema migration. The 7 original
// roles still exist as protected `isSystem` rows.
//
// FINANCE_ROLES / LEAD_ROLES / EMPLOYEE_ROLES / ROLE_TIER below are kept as
// mutable, module-level arrays/objects seeded with the 7 built-in roles.
// Every existing call site across ~100 files does `FINANCE_ROLES.includes(...)`,
// `requireRole(session, LEAD_ROLES)`, or `role: { in: EMPLOYEE_ROLES }` — since
// JS/ESM module exports are shared references, mutating these IN PLACE
// (`.length = 0; .push(...)`) via refreshRoleRegistry() makes every existing
// importer see newly-added custom roles automatically, with no call site
// changes needed. refreshRoleRegistry() must run at server boot and after
// every Role CRUD mutation (see /api/v1/roles routes).

export const Role = {
  admin: "admin",
  hr: "hr",
  tech_lead: "tech_lead",
  sales_lead: "sales_lead",
  tech_employee: "tech_employee",
  sales_employee: "sales_employee",
  bde: "bde",
} as const;

export type Role = string;

const BASE_FINANCE_ROLES = [Role.admin, Role.hr];
const BASE_LEAD_ROLES = [Role.tech_lead, Role.sales_lead];
const BASE_EMPLOYEE_ROLES = [Role.tech_employee, Role.sales_employee, Role.bde];

/** Admin + HR — the only roles allowed to see/edit salary, incentive,
 *  reimbursement, and to approve leave/reimbursement (PRD "golden rule").
 *  Mutable — see refreshRoleRegistry(). */
export const FINANCE_ROLES: Role[] = [...BASE_FINANCE_ROLES];

/** Team Lead roles — scoped to their own team's data. Mutable — see
 *  refreshRoleRegistry(). */
export const LEAD_ROLES: Role[] = [...BASE_LEAD_ROLES];

/** Individual contributor roles — scoped to their own data. Mutable — see
 *  refreshRoleRegistry(). */
export const EMPLOYEE_ROLES: Role[] = [...BASE_EMPLOYEE_ROLES];

export function isAdmin(role: Role): boolean {
  return role === Role.admin;
}

/** Admin or HR — the "finance"/full-access roles. */
export function isFinanceRole(role: Role): boolean {
  return FINANCE_ROLES.includes(role);
}

export function isLeadRole(role: Role): boolean {
  return LEAD_ROLES.includes(role);
}

export function isEmployeeRole(role: Role): boolean {
  return EMPLOYEE_ROLES.includes(role);
}

export function hasRole(role: Role, allowed: readonly Role[]): boolean {
  return allowed.includes(role);
}

/** Hierarchy tier for WorkUnit "project lead" assignment scoping only
 * (2026-08-07) — a project lead (WorkUnit.projectLeadId, which can now be any
 * employee, not just a Lead-role one) may assign SubUnits/WorkItems to anyone
 * at their tier or a less-senior one. Lower number = more authority. Flat
 * across Tech/Sales verticals — NOT used for any other authorization check
 * in the app (approvals, RBAC gates elsewhere are unaffected). Mutable — see
 * refreshRoleRegistry(). */
const ROLE_TIER: Record<Role, number> = {
  [Role.admin]: 0,
  [Role.hr]: 0,
  [Role.tech_lead]: 1,
  [Role.sales_lead]: 1,
  [Role.tech_employee]: 2,
  [Role.sales_employee]: 2,
  [Role.bde]: 2,
};

export function roleTier(role: Role): number {
  return ROLE_TIER[role];
}

/** True if `role` is a currently-known role key (system or custom) — kept in
 * sync with the `roles` table by refreshRoleRegistry(). Use this instead of
 * `z.nativeEnum(Role)`/checking against the static `Role` object wherever a
 * custom role must validate the same as a built-in one. */
export function isKnownRole(role: string): boolean {
  return Object.prototype.hasOwnProperty.call(ROLE_TIER, role);
}

/** Can `actorRole` (a WorkUnit's project lead) assign work to `targetRole`?
 * True when the target is at the actor's tier or a less-senior one. */
export function canAssignAtOrBelow(actorRole: Role, targetRole: Role): boolean {
  return ROLE_TIER[actorRole] <= ROLE_TIER[targetRole];
}

/** All roles a project lead of `actorRole` may assign work to (self-tier and
 * below) — for use in a Prisma `role: { in: [...] }` filter. */
export function rolesAtOrBelow(actorRole: Role): Role[] {
  return Object.keys(ROLE_TIER).filter((r) => ROLE_TIER[r] >= ROLE_TIER[actorRole]);
}

/** Re-reads custom (non-system) roles from the `roles` table and rebuilds
 * FINANCE_ROLES / LEAD_ROLES / EMPLOYEE_ROLES / ROLE_TIER in place, so every
 * existing importer sees the update without any call-site changes. Call at
 * server boot and after any Role create/update/delete. */
export async function refreshRoleRegistry(): Promise<void> {
  const customRoles = await prisma.role.findMany({ where: { isSystem: false } });

  FINANCE_ROLES.length = 0;
  FINANCE_ROLES.push(...BASE_FINANCE_ROLES);
  LEAD_ROLES.length = 0;
  LEAD_ROLES.push(...BASE_LEAD_ROLES);
  EMPLOYEE_ROLES.length = 0;
  EMPLOYEE_ROLES.push(...BASE_EMPLOYEE_ROLES);

  for (const key of Object.keys(ROLE_TIER)) {
    if (!(key in Role)) delete ROLE_TIER[key];
  }

  for (const r of customRoles) {
    if (r.tier === "finance") {
      FINANCE_ROLES.push(r.key);
      ROLE_TIER[r.key] = 0;
    } else if (r.tier === "lead") {
      LEAD_ROLES.push(r.key);
      ROLE_TIER[r.key] = 1;
    } else {
      EMPLOYEE_ROLES.push(r.key);
      ROLE_TIER[r.key] = 2;
    }
  }
}

/** Thrown by requireRole; catch at the route boundary and map to failFor(). */
export class AuthzError extends Error {
  constructor(
    public readonly kind: "UNAUTHENTICATED" | "FORBIDDEN",
    message?: string,
  ) {
    super(message ?? kind);
    this.name = "AuthzError";
  }
}

type SessionLike = { role: Role } | null | undefined;

/**
 * Assert the session exists and its role is allowed. Returns the role on
 * success. Throws AuthzError otherwise — route handlers should catch and
 * convert with `failFor(err.kind)`.
 *
 * Usage:
 *   const session = await getSession();
 *   requireRole(session, FINANCE_ROLES);
 */
export function requireRole(session: SessionLike, allowed: readonly Role[]): Role {
  if (!session) {
    throw new AuthzError("UNAUTHENTICATED");
  }
  if (!allowed.includes(session.role)) {
    throw new AuthzError("FORBIDDEN");
  }
  return session.role;
}
