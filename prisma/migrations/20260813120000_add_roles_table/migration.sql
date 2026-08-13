-- Convert the fixed 7-value "Role" enum into a DB-backed, Admin-editable
-- table so new roles (e.g. "cto") can be added from the app without a
-- schema migration. Hand-written (not `prisma migrate dev --create-only`)
-- because the enum->text column change needs explicit USING casts to avoid
-- data loss, and because this shell is non-interactive.

-- 1. New tier enum + roles table.
CREATE TYPE "RoleTier" AS ENUM ('finance', 'lead', 'employee');

CREATE TABLE "roles" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tier" "RoleTier" NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("key")
);

-- 2. Seed the 7 existing roles as protected system rows before any FK
--    referencing them is added.
INSERT INTO "roles" ("key", "label", "tier", "is_system", "updated_at") VALUES
    ('admin', 'Admin', 'finance', true, CURRENT_TIMESTAMP),
    ('hr', 'HR', 'finance', true, CURRENT_TIMESTAMP),
    ('tech_lead', 'Tech Lead', 'lead', true, CURRENT_TIMESTAMP),
    ('sales_lead', 'Sales Lead', 'lead', true, CURRENT_TIMESTAMP),
    ('tech_employee', 'Tech Employee', 'employee', true, CURRENT_TIMESTAMP),
    ('sales_employee', 'Sales Employee', 'employee', true, CURRENT_TIMESTAMP),
    ('bde', 'BDE', 'employee', true, CURRENT_TIMESTAMP);

-- 3. Convert enum columns to TEXT, preserving existing data via explicit
--    casts (this is exactly the step `prisma migrate dev`'s auto-diff
--    refused to generate without prompting interactively).
ALTER TABLE "employees" ALTER COLUMN "role" TYPE TEXT USING "role"::text;
ALTER TABLE "users" ALTER COLUMN "role" TYPE TEXT USING "role"::text;
ALTER TABLE "audit_logs" ALTER COLUMN "actor_role" TYPE TEXT USING "actor_role"::text;

-- 4. FK constraints from role columns to roles.key.
ALTER TABLE "employees" ADD CONSTRAINT "employees_role_fkey" FOREIGN KEY ("role") REFERENCES "roles"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_role_fkey" FOREIGN KEY ("role") REFERENCES "roles"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5. Drop the old enum type now that nothing references it.
DROP TYPE "Role";
