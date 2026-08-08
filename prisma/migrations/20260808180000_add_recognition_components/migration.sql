-- Pillar 6: composite monthly performance score.
-- Stores the weighted component breakdown that produced `score`, so a monthly
-- snapshot stays explainable after the fact. Nullable: weekly snapshots keep
-- raw single-signal scoring, and pre-existing rows have no breakdown.
ALTER TABLE "recognition_snapshots" ADD COLUMN "components" JSONB;
