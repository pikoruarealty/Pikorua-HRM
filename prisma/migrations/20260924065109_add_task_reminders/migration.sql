-- CreateEnum
CREATE TYPE "TaskReminderContentMode" AS ENUM ('count', 'full_list', 'per_task');

-- CreateEnum
CREATE TYPE "TaskReminderScope" AS ENUM ('due_today', 'all_pending');

-- CreateTable
CREATE TABLE "task_reminder_config" (
    "id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "interval_minutes" INTEGER NOT NULL DEFAULT 120,
    "content_mode" "TaskReminderContentMode" NOT NULL DEFAULT 'count',
    "scope" "TaskReminderScope" NOT NULL DEFAULT 'all_pending',
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "task_reminder_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_reminder_state" (
    "employee_id" UUID NOT NULL,
    "last_sent_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "task_reminder_state_pkey" PRIMARY KEY ("employee_id")
);

-- AddForeignKey
ALTER TABLE "task_reminder_state" ADD CONSTRAINT "task_reminder_state_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
