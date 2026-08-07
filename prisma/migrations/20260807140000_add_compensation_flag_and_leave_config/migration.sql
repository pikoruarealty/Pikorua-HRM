-- AlterTable: manual compensation-day flag on attendance_records
ALTER TABLE "attendance_records" ADD COLUMN     "is_compensation" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: admin-configurable paid-leave allowance (versioned, like payroll_config)
CREATE TABLE "leave_config" (
    "id" UUID NOT NULL,
    "paid_leaves_per_month" INTEGER NOT NULL,
    "paid_leaves_per_year" INTEGER NOT NULL,
    "effective_from" DATE NOT NULL,

    CONSTRAINT "leave_config_pkey" PRIMARY KEY ("id")
);
