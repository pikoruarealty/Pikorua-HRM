import { describe, expect, test } from "bun:test";
import {
  AuthzError,
  FINANCE_ROLES,
  LEAD_ROLES,
  Role,
  isFinanceRole,
  requireRole,
} from "./index";

// Golden rule (PRD §3): salary/incentive/reimbursement data and leave/
// reimbursement approval are Admin/HR only — Leads and Employees never pass
// a FINANCE_ROLES gate.

describe("requireRole", () => {
  test("throws UNAUTHENTICATED when there is no session", () => {
    try {
      requireRole(null, FINANCE_ROLES);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthzError);
      expect((err as AuthzError).kind).toBe("UNAUTHENTICATED");
    }
  });

  test("throws FORBIDDEN for a role outside the allowlist", () => {
    for (const role of [Role.tech_lead, Role.sales_lead, Role.tech_employee, Role.sales_employee, Role.bde]) {
      try {
        requireRole({ role }, FINANCE_ROLES);
        throw new Error(`golden rule breached for ${role}`);
      } catch (err) {
        expect(err).toBeInstanceOf(AuthzError);
        expect((err as AuthzError).kind).toBe("FORBIDDEN");
      }
    }
  });

  test("returns the role for allowed sessions", () => {
    expect(requireRole({ role: Role.admin }, FINANCE_ROLES)).toBe(Role.admin);
    expect(requireRole({ role: Role.hr }, FINANCE_ROLES)).toBe(Role.hr);
  });
});

describe("role groups", () => {
  test("finance roles are exactly admin and hr", () => {
    expect([...FINANCE_ROLES].sort()).toEqual([Role.admin, Role.hr].sort());
    expect(isFinanceRole(Role.admin)).toBe(true);
    expect(isFinanceRole(Role.hr)).toBe(true);
    expect(isFinanceRole(Role.tech_lead)).toBe(false);
  });

  test("leads are never finance roles", () => {
    for (const role of LEAD_ROLES) {
      expect(isFinanceRole(role)).toBe(false);
    }
  });
});
