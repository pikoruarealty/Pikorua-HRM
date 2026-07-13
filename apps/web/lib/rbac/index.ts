import { Role } from "@prisma/client";

// SHARED (Phase 0). Role model + guards used by every API route in both tracks.
// Roles are grouped so PRD §3 rules read declaratively and adding a role later
// (e.g. a confirmed `bde_lead`) is a one-line change in the right group.
//
// NOTE: `bde_lead` is NOT yet a role (unconfirmed — PRD §7). If confirmed, add
// it to the Prisma `Role` enum AND to LEAD_ROLES below.

export { Role };

/** Admin + HR — the only roles allowed to see/edit salary, incentive,
 *  reimbursement, and to approve leave/reimbursement (PRD "golden rule"). */
export const FINANCE_ROLES: readonly Role[] = [Role.admin, Role.hr];

/** Team Lead roles — scoped to their own team's data. */
export const LEAD_ROLES: readonly Role[] = [Role.tech_lead, Role.sales_lead];

/** Individual contributor roles — scoped to their own data. */
export const EMPLOYEE_ROLES: readonly Role[] = [
  Role.tech_employee,
  Role.sales_employee,
  Role.bde,
];

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
