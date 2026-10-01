-- Half-day leave + fractional payslip counts (2026-10-01).
--
-- requests.half_day: a leave row that covers half of one day. Existing rows are
-- all whole days, so the default is false and nothing changes for them.
ALTER TABLE "requests" ADD COLUMN "half_day" BOOLEAN NOT NULL DEFAULT false;

-- payslips: paid/unpaid leave and absent counts can be half days now (a half-day
-- leave, or a part-timer's half-day quota shortfall). They were INTEGER, which
-- would reject the whole payslip. Every existing value is a whole number, so the
-- cast is lossless.
ALTER TABLE "payslips"
  ALTER COLUMN "unpaid_leave_count" SET DATA TYPE DOUBLE PRECISION,
  ALTER COLUMN "absent_count" SET DATA TYPE DOUBLE PRECISION,
  ALTER COLUMN "paid_leave_count" SET DATA TYPE DOUBLE PRECISION;
