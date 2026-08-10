-- CreateEnum
CREATE TYPE "SalesMetric" AS ENUM ('calls', 'site_visits', 'bookings');

-- CreateEnum
CREATE TYPE "SalesMatchMethod" AS ENUM ('email', 'name', 'unmatched');

-- CreateEnum
CREATE TYPE "OfflineClaimStatus" AS ENUM ('pending', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "daily_call_target" INTEGER,
ADD COLUMN     "monthly_booking_target" INTEGER,
ADD COLUMN     "monthly_site_visit_target" INTEGER;

-- AlterTable
ALTER TABLE "work_items" ADD COLUMN     "adhoc_type_id" UUID,
ADD COLUMN     "repeat_daily" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sales_metric" "SalesMetric",
ADD COLUMN     "self_logged" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "adhoc_task_types" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "adhoc_task_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_activity_sync" (
    "id" UUID NOT NULL,
    "employee_id" UUID,
    "crm_email" TEXT NOT NULL,
    "crm_name" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "calls_made" INTEGER NOT NULL DEFAULT 0,
    "site_visits" INTEGER NOT NULL DEFAULT 0,
    "bookings_confirmed" INTEGER NOT NULL DEFAULT 0,
    "match_method" "SalesMatchMethod" NOT NULL,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_activity_sync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offline_activity_claims" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "calls" INTEGER NOT NULL,
    "note" TEXT NOT NULL,
    "status" "OfflineClaimStatus" NOT NULL DEFAULT 'pending',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "review_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offline_activity_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_target_config" (
    "id" UUID NOT NULL,
    "daily_call_target" INTEGER NOT NULL DEFAULT 100,
    "monthly_site_visit_target" INTEGER NOT NULL DEFAULT 20,
    "monthly_booking_target" INTEGER NOT NULL DEFAULT 2,
    "auto_assign_daily_calls" BOOLEAN NOT NULL DEFAULT true,
    "effective_from" DATE NOT NULL,

    CONSTRAINT "sales_target_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance_config" (
    "id" UUID NOT NULL,
    "scoring_enabled" BOOLEAN NOT NULL DEFAULT false,
    "self_logged_cap_percent" INTEGER NOT NULL DEFAULT 30,
    "effective_from" DATE NOT NULL,

    CONSTRAINT "performance_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "adhoc_task_types_key_key" ON "adhoc_task_types"("key");

-- CreateIndex
CREATE INDEX "sales_activity_sync_employee_id_date_idx" ON "sales_activity_sync"("employee_id", "date");

-- CreateIndex
CREATE INDEX "sales_activity_sync_match_method_idx" ON "sales_activity_sync"("match_method");

-- CreateIndex
CREATE UNIQUE INDEX "sales_activity_sync_crm_email_date_key" ON "sales_activity_sync"("crm_email", "date");

-- CreateIndex
CREATE INDEX "offline_activity_claims_employee_id_date_idx" ON "offline_activity_claims"("employee_id", "date");

-- CreateIndex
CREATE INDEX "offline_activity_claims_status_idx" ON "offline_activity_claims"("status");

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_adhoc_type_id_fkey" FOREIGN KEY ("adhoc_type_id") REFERENCES "adhoc_task_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_activity_sync" ADD CONSTRAINT "sales_activity_sync_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offline_activity_claims" ADD CONSTRAINT "offline_activity_claims_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offline_activity_claims" ADD CONSTRAINT "offline_activity_claims_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

