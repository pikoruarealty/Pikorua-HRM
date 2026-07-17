-- Payroll formula change (2026-07-17): late deduction becomes a % of a
-- day's pay instead of a flat rupee amount; half-day/unpaid-leave/absent
-- deductions are no longer separately configurable (derived from
-- base_salary directly in application code) so their flat-rate columns are
-- dropped. Existing config rows get late_deduction_percent = 0 (safe
-- default — no surprise deduction until Admin explicitly sets a rate via
-- PUT /payroll/config).

ALTER TABLE "payroll_config" ADD COLUMN "late_deduction_percent" DECIMAL(5,2);
UPDATE "payroll_config" SET "late_deduction_percent" = 0;
ALTER TABLE "payroll_config" ALTER COLUMN "late_deduction_percent" SET NOT NULL;
ALTER TABLE "payroll_config" DROP COLUMN "late_deduction_flat";
ALTER TABLE "payroll_config" DROP COLUMN "half_day_deduction_flat";
ALTER TABLE "payroll_config" DROP COLUMN "unpaid_leave_deduction_flat";

-- AlterTable
ALTER TABLE "payslips" ADD COLUMN "absent_count" INTEGER NOT NULL DEFAULT 0;
