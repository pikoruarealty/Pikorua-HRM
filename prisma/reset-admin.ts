/**
 * Pikorua HRM — reset-admin script.
 *
 * DESTRUCTIVE: wipes every table in the database, then creates exactly one
 * admin user + employee record. Use this to blow away a dev/test database
 * back to "just admin" — NOT for regaining access to a populated environment
 * you want to keep (there is no partial/surgical mode here anymore).
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

// This script wipes the whole database and provisions a real login with a
// password that may be a well-known default — refuse to run in production
// unless explicitly and deliberately overridden, same posture as seed.ts.
function assertNotProduction(): void {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_SEED !== "true") {
    console.error(
      "[reset-admin] Refusing to run: NODE_ENV=production. Set ALLOW_PROD_SEED=true if you really mean to.",
    );
    process.exit(1);
  }
}

// Truncates every table in the public schema (except Prisma's own migration
// history) via raw SQL rather than a hand-ordered deleteMany per model, so
// this never goes stale as new tables are added to schema.prisma.
async function wipeDatabase(): Promise<void> {
  const tables = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != '_prisma_migrations'`,
  );
  if (tables.length === 0) return;
  const names = tables.map((t) => `"${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
  console.log(`[reset-admin] Wiped ${tables.length} table(s).`);
}

async function main() {
  assertNotProduction();
  await wipeDatabase();

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

  const employee = await prisma.employee.create({
    data: {
      fullName: ADMIN_FULL_NAME,
      email: ADMIN_EMAIL,
      role: Role.admin,
      dateOfJoining: new Date(),
      baseSalary: 0,
    },
  });

  await prisma.user.create({
    data: {
      email: ADMIN_EMAIL,
      passwordHash,
      role: Role.admin,
      employeeId: employee.id,
    },
  });

  console.log("[reset-admin] Done — database wiped, one admin account created.");
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
