-- 2026-10-24: WFH weekly-hours cap (+ Admin extra approvals), location-aware
-- compensation credits, and WFH auto clock-out marker. All additive and
-- defaulted, so the still-running previous container keeps working.

-- AlterTable
ALTER TABLE "attendance_sessions" ADD COLUMN "auto_closed" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "payroll_config" ADD COLUMN "wfh_weekly_cap_hours" DECIMAL(5,2) NOT NULL DEFAULT 10;

-- AlterTable
ALTER TABLE "compensation_credits" ADD COLUMN "work_location" "WorkLocation" NOT NULL DEFAULT 'office';

-- Credits that already exist take the location of the day that earned them.
UPDATE "compensation_credits" AS c
SET "work_location" = r."work_location"
FROM "attendance_records" AS r
WHERE r."id" = c."source_record_id";

-- CreateTable
CREATE TABLE "wfh_weekly_approvals" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "week_start" DATE NOT NULL,
    "extra_hours" DECIMAL(5,2) NOT NULL,
    "approved_by" UUID NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "wfh_weekly_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wfh_weekly_approvals_employee_id_week_start_key" ON "wfh_weekly_approvals"("employee_id", "week_start");

-- AddForeignKey
ALTER TABLE "wfh_weekly_approvals" ADD CONSTRAINT "wfh_weekly_approvals_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wfh_weekly_approvals" ADD CONSTRAINT "wfh_weekly_approvals_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
