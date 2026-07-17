-- Payroll formula change (2026-07-17, follow-up): net pay is now
-- earnings-based (present/half-day/paid-leave/holiday/compensation days are
-- paid at the per-day rate; unpaid-leave/absent days are simply excluded,
-- not separately deducted) instead of "full base_salary minus deductions".
-- No existing payslips rows at the time of this migration (count = 0), so a
-- straight rename is safe.

ALTER TABLE "payslips" RENAME COLUMN "standard_deduction_total" TO "late_deduction_total";
ALTER TABLE "payslips" ADD COLUMN "present_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "payslips" ADD COLUMN "paid_leave_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "payslips" ADD COLUMN "holiday_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "payslips" ADD COLUMN "compensation_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "payslips" ADD COLUMN "earned_base_pay" DECIMAL(12,2) NOT NULL DEFAULT 0;
