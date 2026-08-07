-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('fulltime', 'parttime', 'intern');

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "employment_type" "EmploymentType" NOT NULL DEFAULT 'fulltime',
ADD COLUMN     "required_days_per_week" INTEGER,
ADD COLUMN     "default_weekly_off_day" INTEGER;

-- AlterTable
ALTER TABLE "leave_config" ADD COLUMN     "part_time_paid_leaves_per_month" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "part_time_paid_leaves_per_year" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "intern_paid_leaves_per_month" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "intern_paid_leaves_per_year" INTEGER NOT NULL DEFAULT 0;
