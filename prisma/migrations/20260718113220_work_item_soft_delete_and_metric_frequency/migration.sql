-- CreateEnum
CREATE TYPE "WorkItemFrequency" AS ENUM ('daily', 'monthly');

-- DropIndex
DROP INDEX "work_items_mode_period_year_period_month_idx";

-- AlterTable
ALTER TABLE "sub_units" ADD COLUMN     "deleted_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "work_items" ADD COLUMN     "deleted_at" TIMESTAMPTZ(6),
ADD COLUMN     "frequency" "WorkItemFrequency",
ADD COLUMN     "period_day" INTEGER;

-- AlterTable
ALTER TABLE "work_units" ADD COLUMN     "deleted_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX "work_items_mode_period_year_period_month_period_day_idx" ON "work_items"("mode", "period_year", "period_month", "period_day");

-- Backfill: every pre-existing metric-mode WorkItem was tracked monthly (the
-- only frequency that existed before this migration), so period_day stays
-- NULL for them, matching the existing periodMonth/periodYear-only rows.
UPDATE "work_items" SET "frequency" = 'monthly' WHERE "mode" = 'metric';
