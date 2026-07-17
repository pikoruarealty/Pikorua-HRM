-- Add configurable late-arrival grace window (minutes) to payroll_config.
-- Default 0 preserves the prior exact-to-the-minute lateness behaviour.
ALTER TABLE "payroll_config" ADD COLUMN "late_grace_minutes" INTEGER NOT NULL DEFAULT 0;
