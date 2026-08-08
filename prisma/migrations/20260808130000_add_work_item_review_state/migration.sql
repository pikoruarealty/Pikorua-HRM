-- AlterEnum
-- Tiered point crediting (Pillar 2): tasks above the auto-credit threshold pass
-- through in_review before completed. Placed before 'completed' so the enum's
-- declaration order still matches the workflow order.
ALTER TYPE "WorkItemStatus" ADD VALUE 'in_review' BEFORE 'completed';

-- AlterTable
ALTER TABLE "work_items" ADD COLUMN     "submitted_at" TIMESTAMPTZ(6),
ADD COLUMN     "reviewed_by" UUID,
ADD COLUMN     "reviewed_at" TIMESTAMPTZ(6),
ADD COLUMN     "review_note" TEXT;

-- CreateIndex
CREATE INDEX "work_items_status_idx" ON "work_items"("status");

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
