-- Team.expectedStartTime now defaults to "11:00" instead of no default
-- (owner request, 2026-08-08) -- existing rows are left untouched (still
-- NULL where previously unset); only new inserts that omit the column pick
-- up the new default. The app layer also always sends an explicit value now.
ALTER TABLE "teams" ALTER COLUMN "expected_start_time" SET DEFAULT '11:00';
