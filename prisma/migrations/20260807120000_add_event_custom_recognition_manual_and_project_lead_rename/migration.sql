-- AlterEnum: Event.custom (Admin/HR-logged milestone tied to one employee)
ALTER TYPE "EventType" ADD VALUE 'custom';

-- AlterTable: RecognitionSnapshot manual-publish fields
ALTER TABLE "recognition_snapshots" ADD COLUMN     "published_at" TIMESTAMPTZ(6),
ADD COLUMN     "selected_manually" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "recognition_snapshots_is_employee_of_month_published_at_idx" ON "recognition_snapshots"("is_employee_of_month", "published_at");

-- Rename WorkUnit.teamLeadId -> projectLeadId, preserving existing data and
-- the FK (a project lead can now be any employee, not just a Lead-role one —
-- see lib/rbac's canAssignAtOrBelow). Renamed in place (not drop+recreate) so
-- existing WorkUnit rows keep their lead reference.
ALTER TABLE "work_units" RENAME COLUMN "team_lead_id" TO "project_lead_id";
ALTER TABLE "work_units" RENAME CONSTRAINT "work_units_team_lead_id_fkey" TO "work_units_project_lead_id_fkey";
