-- CreateTable
CREATE TABLE "recognition_leaderboard_publishes" (
    "id" UUID NOT NULL,
    "period_type" "RecognitionPeriodType" NOT NULL,
    "period_start" DATE NOT NULL,
    "department_id" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_by" UUID NOT NULL,

    CONSTRAINT "recognition_leaderboard_publishes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "recognition_leaderboard_publishes_period_type_period_start__key" ON "recognition_leaderboard_publishes"("period_type", "period_start", "department_id");

-- AddForeignKey
ALTER TABLE "recognition_leaderboard_publishes" ADD CONSTRAINT "recognition_leaderboard_publishes_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recognition_leaderboard_publishes" ADD CONSTRAINT "recognition_leaderboard_publishes_published_by_fkey" FOREIGN KEY ("published_by") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
