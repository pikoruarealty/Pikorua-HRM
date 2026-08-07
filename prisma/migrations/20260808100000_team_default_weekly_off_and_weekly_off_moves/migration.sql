-- AlterTable: per-team default weekly-off day (0=Sunday..6=Saturday), replacing
-- the old hardcoded "Sunday is always off" rule. Defaults to Sunday so nothing
-- changes for teams that don't customize it.
ALTER TABLE "teams" ADD COLUMN     "default_weekly_off_day" INTEGER NOT NULL DEFAULT 0;

-- CreateTable: per-employee, per-week self-declared override of the team's
-- default off day.
CREATE TABLE "weekly_off_moves" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "week_start" DATE NOT NULL,
    "date" DATE NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "reverted_by" UUID,
    "reverted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weekly_off_moves_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "weekly_off_moves_employee_id_week_start_key" ON "weekly_off_moves"("employee_id", "week_start");

ALTER TABLE "weekly_off_moves" ADD CONSTRAINT "weekly_off_moves_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "weekly_off_moves" ADD CONSTRAINT "weekly_off_moves_reverted_by_fkey" FOREIGN KEY ("reverted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
