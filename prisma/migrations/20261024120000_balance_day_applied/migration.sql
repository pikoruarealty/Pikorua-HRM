-- 2026-10-24: a compensation ("balance") credit can be used on purpose for a
-- specific absent / unpaid-leave day. Additive and defaulted.

-- AlterEnum
ALTER TYPE "RequestType" ADD VALUE 'balance_day';

-- AlterTable
ALTER TABLE "compensation_credits" ADD COLUMN "applied" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "applied_by_user_id" UUID,
ADD COLUMN "applied_at" TIMESTAMPTZ(6);
