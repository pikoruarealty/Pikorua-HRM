-- CreateEnum
CREATE TYPE "PunchDirection" AS ENUM ('in', 'out', 'unknown');

-- AlterTable
ALTER TABLE "employees" ALTER COLUMN "device_uid" SET DATA TYPE TEXT;

-- CreateTable
CREATE TABLE "device_punch_raw" (
    "id" UUID NOT NULL,
    "device_uid" TEXT NOT NULL,
    "punch_time" TIMESTAMPTZ(6) NOT NULL,
    "direction" "PunchDirection" NOT NULL DEFAULT 'unknown',
    "machine_id" TEXT,
    "dedup_key" TEXT NOT NULL,
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reconciled_at" TIMESTAMPTZ(6),
    "reconciled_session_id" UUID,

    CONSTRAINT "device_punch_raw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_sync_cursor" (
    "id" UUID NOT NULL,
    "last_record" TEXT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "device_sync_cursor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "device_punch_raw_dedup_key_key" ON "device_punch_raw"("dedup_key");

-- CreateIndex
CREATE INDEX "device_punch_raw_device_uid_punch_time_idx" ON "device_punch_raw"("device_uid", "punch_time");

-- CreateIndex
CREATE INDEX "device_punch_raw_reconciled_at_idx" ON "device_punch_raw"("reconciled_at");

-- AddForeignKey
ALTER TABLE "device_punch_raw" ADD CONSTRAINT "device_punch_raw_reconciled_session_id_fkey" FOREIGN KEY ("reconciled_session_id") REFERENCES "attendance_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
