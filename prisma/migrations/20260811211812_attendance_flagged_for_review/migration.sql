-- AlterTable
ALTER TABLE "attendance_records" ADD COLUMN     "flag_reason" TEXT,
ADD COLUMN     "flagged_for_review" BOOLEAN NOT NULL DEFAULT false;
