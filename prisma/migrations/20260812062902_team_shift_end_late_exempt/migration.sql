-- AlterTable
ALTER TABLE "attendance_records" ADD COLUMN     "late_exempt" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "late_exempt_reason" TEXT;

-- AlterTable
ALTER TABLE "teams" ADD COLUMN     "expected_end_time" TEXT DEFAULT '19:00';
