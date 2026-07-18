/**
 * Pikorua HRM — reset-admin script.
 *
 * STRICTLY scoped: upserts exactly one admin user + employee record.
 * Does NOT touch departments, teams, payroll config, other employees/users,
 * or any other table — unlike prisma/seed.ts, this never seeds the rest of
 * the baseline dataset. Safe to re-run (idempotent upsert by email).
 *
 * Use this to regain admin access without reseeding/wiping the rest of a
 * database (e.g. a stuck/locked-out admin login in a populated environment).
 *
 * Run with:  bun prisma/reset-admin.ts   (or `bun run db:reset-admin`)
 * Override the login via env vars: ADMIN_EMAIL, ADMIN_PASSWORD.
 */
import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@pikorua.test";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Password123!";
const ADMIN_FULL_NAME = "Admin User";

// This script provisions/resets a real login with a password that may be a
// well-known default — refuse to run in production unless explicitly and
// deliberately overridden, same posture as prisma/seed.ts.
function assertNotProduction(): void {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_SEED !== "true") {
    console.error(
      "[reset-admin] Refusing to run: NODE_ENV=production. Set ALLOW_PROD_SEED=true if you really mean to.",
    );
    process.exit(1);
  }
}

async function main() {
  assertNotProduction();
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

  const employee = await prisma.employee.upsert({
    where: { email: ADMIN_EMAIL },
    update: {
      fullName: ADMIN_FULL_NAME,
      role: Role.admin,
    },
    create: {
      fullName: ADMIN_FULL_NAME,
      email: ADMIN_EMAIL,
      role: Role.admin,
      dateOfJoining: new Date(),
      baseSalary: 0,
    },
  });

  await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: {
      role: Role.admin,
      employeeId: employee.id,
      passwordHash,
      tokenVersion: { increment: 1 }, // revoke any stale sessions for this login
    },
    create: {
      email: ADMIN_EMAIL,
      passwordHash,
      role: Role.admin,
      employeeId: employee.id,
    },
  });

  console.log("[reset-admin] Done — one admin account only, nothing else touched.");
  console.log(`  Email:    ${ADMIN_EMAIL}`);
  console.log(`  Password: ${ADMIN_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
