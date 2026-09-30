-- Weekly-off auto-assignment, WFH allow switch and expected WFH hours (2026-09-30).

-- AlterTable
ALTER TABLE "employees"
  ADD COLUMN "wfh_allowed" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "expected_wfh_hours_per_week" DECIMAL(5,2);

-- CreateTable
CREATE TABLE "unpaid_day_declarations" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unpaid_day_declarations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "unpaid_day_declarations_employee_id_date_key" ON "unpaid_day_declarations"("employee_id", "date");

-- AddForeignKey
ALTER TABLE "unpaid_day_declarations" ADD CONSTRAINT "unpaid_day_declarations_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
