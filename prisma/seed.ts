/**
 * Pikorua HRM — Phase 0 seed script.
 * Creates baseline data both dev tracks can build against immediately:
 *   - global payroll_config (flat deduction rates)
 *   - 3 departments (Tech / Sales / B.D.) with their department_labels
 *   - one team per department
 *   - one user+employee for each of the 7 roles
 *
 * Idempotent: re-running upserts by email, so it's safe to run repeatedly.
 * Run with:  npm run db:seed   (from repo root)
 */
import { PrismaClient, Role, WorkItemMode } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DEFAULT_PASSWORD = "Password123!";

// This seed provisions real login accounts (including admin/hr) with the
// well-known DEFAULT_PASSWORD above. Running it against production would create
// or reset accounts to a password that is committed to the repo, so refuse to
// run in production unless explicitly and deliberately overridden.
function assertNotProduction(): void {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_SEED !== "true") {
    console.error(
      "[seed] Refusing to run: NODE_ENV=production. This seed creates accounts with a public default password. " +
        "If you really mean to, set ALLOW_PROD_SEED=true.",
    );
    process.exit(1);
  }
}

async function main() {
  assertNotProduction();
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  // --- Payroll config (singleton-ish; keyed by effective_from) ---------------
  const existingConfig = await prisma.payrollConfig.findFirst();
  if (!existingConfig) {
    await prisma.payrollConfig.create({
      data: {
        lateDeductionFlat: 200,
        unpaidLeaveDeductionFlat: 1000,
        halfDayDeductionFlat: 500,
        effectiveFrom: new Date("2026-01-01"),
      },
    });
  }

  // --- Departments + label config -------------------------------------------
  const departmentSeeds = [
    {
      name: "Tech",
      typeKey: "tech",
      labels: {
        workUnitLabel: "Project",
        subUnitLabel: "Feature",
        workItemLabel: "Task",
        workItemMode: WorkItemMode.atomic,
      },
    },
    {
      name: "Sales",
      typeKey: "sales",
      labels: {
        workUnitLabel: "Campaign",
        subUnitLabel: "Target Segment",
        workItemLabel: "Call",
        workItemMode: WorkItemMode.metric,
      },
    },
    {
      name: "B.D.",
      typeKey: "bd",
      labels: {
        workUnitLabel: "Campaign",
        subUnitLabel: "Deal Stage",
        workItemLabel: "Follow-up",
        workItemMode: WorkItemMode.metric,
      },
    },
  ];

  const departments: Record<string, string> = {}; // typeKey -> department id
  for (const d of departmentSeeds) {
    // departments has no unique constraint on type_key, so guard manually.
    let dept = await prisma.department.findFirst({ where: { typeKey: d.typeKey } });
    if (!dept) {
      dept = await prisma.department.create({
        data: { name: d.name, typeKey: d.typeKey },
      });
    }
    departments[d.typeKey] = dept.id;

    await prisma.departmentLabel.upsert({
      where: { departmentTypeKey: d.typeKey },
      update: d.labels,
      create: { departmentTypeKey: d.typeKey, ...d.labels },
    });
  }

  // --- Employees (one per role) ---------------------------------------------
  // Admin/HR are finance/system roles — left without a department.
  const employeeSeeds: {
    key: string;
    fullName: string;
    email: string;
    role: Role;
    typeKey: string | null;
  }[] = [
    { key: "admin", fullName: "Admin User", email: "admin@pikorua.test", role: Role.admin, typeKey: null },
    { key: "hr", fullName: "HR User", email: "hr@pikorua.test", role: Role.hr, typeKey: null },
    { key: "tech_lead", fullName: "Tech Lead", email: "tech.lead@pikorua.test", role: Role.tech_lead, typeKey: "tech" },
    { key: "tech_emp", fullName: "Tech Employee", email: "tech.emp@pikorua.test", role: Role.tech_employee, typeKey: "tech" },
    { key: "sales_lead", fullName: "Sales Lead", email: "sales.lead@pikorua.test", role: Role.sales_lead, typeKey: "sales" },
    { key: "sales_emp", fullName: "Sales Employee", email: "sales.emp@pikorua.test", role: Role.sales_employee, typeKey: "sales" },
    { key: "bde", fullName: "BD Executive", email: "bde@pikorua.test", role: Role.bde, typeKey: "bd" },
  ];

  const employees: Record<string, string> = {}; // key -> employee id
  for (const e of employeeSeeds) {
    const emp = await prisma.employee.upsert({
      where: { email: e.email },
      update: {
        fullName: e.fullName,
        role: e.role,
        departmentId: e.typeKey ? departments[e.typeKey] : null,
      },
      create: {
        fullName: e.fullName,
        email: e.email,
        role: e.role,
        departmentId: e.typeKey ? departments[e.typeKey] : null,
        dateOfJoining: new Date("2025-01-01"),
        baseSalary: 50000,
      },
    });
    employees[e.key] = emp.id;
  }

  // --- Teams (one per department, led by that department's lead) -------------
  const teamSeeds = [
    { name: "Tech Team 1", typeKey: "tech", leadKey: "tech_lead", memberKeys: ["tech_emp"] },
    { name: "Sales Team 1", typeKey: "sales", leadKey: "sales_lead", memberKeys: ["sales_emp"] },
    { name: "BD Team 1", typeKey: "bd", leadKey: null as string | null, memberKeys: ["bde"] },
  ];

  for (const t of teamSeeds) {
    let team = await prisma.team.findFirst({ where: { name: t.name } });
    if (!team) {
      team = await prisma.team.create({
        data: {
          name: t.name,
          departmentId: departments[t.typeKey],
          teamLeadId: t.leadKey ? employees[t.leadKey] : null,
        },
      });
    }
    // Assign lead + members to this team.
    const memberIds = [
      ...(t.leadKey ? [employees[t.leadKey]] : []),
      ...t.memberKeys.map((k) => employees[k]),
    ];
    await prisma.employee.updateMany({
      where: { id: { in: memberIds } },
      data: { teamId: team.id },
    });
  }

  // --- Users (login accounts, linked to employees) ---------------------------
  for (const e of employeeSeeds) {
    await prisma.user.upsert({
      where: { email: e.email },
      update: { role: e.role, employeeId: employees[e.key] },
      create: {
        email: e.email,
        passwordHash,
        role: e.role,
        employeeId: employees[e.key],
      },
    });
  }

  console.log("Seed complete.");
  console.log(`  Users created/updated: ${employeeSeeds.length}`);
  console.log(`  Default password for every seeded account: ${DEFAULT_PASSWORD}`);
  console.log("  Logins: " + employeeSeeds.map((e) => e.email).join(", "));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
