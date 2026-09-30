-- The day an employee's expected WFH hours target was set, so the advance/late
-- balance only measures weeks the target actually applied to (2026-09-30).

-- AlterTable
ALTER TABLE "employees" ADD COLUMN "expected_wfh_hours_since" DATE;
