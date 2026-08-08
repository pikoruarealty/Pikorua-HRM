-- CreateTable
-- Monthly Lead-entered quality review (Pillar 3). One row per
-- (employee, reviewer, period) — the unique index below is what makes a repeat
-- submission a 409 instead of a silent second opinion.
CREATE TABLE "performance_reviews" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "period_year" INTEGER NOT NULL,
    "period_month" INTEGER NOT NULL,
    "rating" INTEGER NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "performance_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "performance_reviews_employee_id_period_year_period_month_idx" ON "performance_reviews"("employee_id", "period_year", "period_month");

-- CreateIndex
CREATE INDEX "performance_reviews_reviewer_id_period_year_period_month_idx" ON "performance_reviews"("reviewer_id", "period_year", "period_month");

-- CreateIndex
CREATE UNIQUE INDEX "performance_reviews_employee_id_reviewer_id_period_year_per_key" ON "performance_reviews"("employee_id", "reviewer_id", "period_year", "period_month");

-- AddForeignKey
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
