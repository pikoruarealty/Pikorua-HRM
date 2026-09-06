-- Leave-type overhaul (2026-09-06, owner request): retires RequestType.leave_paid
-- in favor of leave_casual/leave_sick (leave_unpaid unchanged, still both a
-- directly-requestable type and the auto-overflow target). Existing
-- leave_paid rows are migrated to leave_casual — a reasonable default, since
-- the two new types share one combined balance pool anyway (no numeric
-- allowance changes as a result of this remap).
--
-- AlterEnum
BEGIN;
CREATE TYPE "RequestType_new" AS ENUM ('leave_casual', 'leave_sick', 'leave_unpaid', 'reimbursement', 'wfh', 'other');
ALTER TABLE "requests" ALTER COLUMN "type" TYPE "RequestType_new" USING (
  CASE "type"::text
    WHEN 'leave_paid' THEN 'leave_casual'
    ELSE "type"::text
  END
)::"RequestType_new";
ALTER TYPE "RequestType" RENAME TO "RequestType_old";
ALTER TYPE "RequestType_new" RENAME TO "RequestType";
DROP TYPE "RequestType_old";
COMMIT;

-- Comp-off ledger (2026-09-06, owner request): 60-day-expiry credits, one per
-- compensation-earning attendance record, redeemable against an approved
-- leave_unpaid day within that window (see lib/leave/compensation-credits.ts).
-- CreateTable
CREATE TABLE "compensation_credits" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "earned_date" DATE NOT NULL,
    "expires_at" DATE NOT NULL,
    "source_record_id" UUID NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "consumed_for_date" DATE,
    "consumed_for_request_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compensation_credits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "compensation_credits_source_record_id_key" ON "compensation_credits"("source_record_id");

-- CreateIndex
CREATE INDEX "compensation_credits_employee_id_consumed_at_idx" ON "compensation_credits"("employee_id", "consumed_at");

-- AddForeignKey
ALTER TABLE "compensation_credits" ADD CONSTRAINT "compensation_credits_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compensation_credits" ADD CONSTRAINT "compensation_credits_source_record_id_fkey" FOREIGN KEY ("source_record_id") REFERENCES "attendance_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compensation_credits" ADD CONSTRAINT "compensation_credits_consumed_for_request_id_fkey" FOREIGN KEY ("consumed_for_request_id") REFERENCES "requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
