-- CreateEnum
CREATE TYPE "WorkLocation" AS ENUM ('office', 'wfh');

-- AlterTable
ALTER TABLE "attendance_records" ADD COLUMN     "work_location" "WorkLocation" NOT NULL DEFAULT 'office';

-- CreateTable
CREATE TABLE "attendance_sessions" (
    "id" UUID NOT NULL,
    "attendance_record_id" UUID NOT NULL,
    "clock_in" TIMESTAMPTZ(6) NOT NULL,
    "clock_out" TIMESTAMPTZ(6),
    "source" "AttendanceSource" NOT NULL DEFAULT 'manual',
    "work_location" "WorkLocation" NOT NULL DEFAULT 'office',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_sessions_attendance_record_id_idx" ON "attendance_sessions"("attendance_record_id");

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_attendance_record_id_fkey" FOREIGN KEY ("attendance_record_id") REFERENCES "attendance_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every existing day was a single stretch of work, so it becomes one
-- session. Without this, already-recorded days would sum to zero worked hours
-- and every open day would look "not clocked in" to isClockedInNow().
INSERT INTO "attendance_sessions" ("id", "attendance_record_id", "clock_in", "clock_out", "source", "work_location", "created_at")
SELECT gen_random_uuid(), r."id", r."clock_in_raw", r."clock_out_raw", r."source", 'office', r."created_at"
FROM "attendance_records" r
WHERE r."clock_in_raw" IS NOT NULL;
