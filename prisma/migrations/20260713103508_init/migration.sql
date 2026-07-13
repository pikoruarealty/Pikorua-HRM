-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'hr', 'tech_lead', 'sales_lead', 'tech_employee', 'sales_employee', 'bde');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "WorkItemMode" AS ENUM ('atomic', 'metric');

-- CreateEnum
CREATE TYPE "WorkUnitStatus" AS ENUM ('active', 'completed', 'archived');

-- CreateEnum
CREATE TYPE "WorkItemStatus" AS ENUM ('pending', 'wip', 'completed');

-- CreateEnum
CREATE TYPE "AttendanceApprovalStatus" AS ENUM ('pending', 'approved');

-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('manual', 'device_sync', 'manual_import');

-- CreateEnum
CREATE TYPE "RequestType" AS ENUM ('leave_paid', 'leave_unpaid', 'reimbursement', 'wfh', 'other');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "PayslipStatus" AS ENUM ('draft', 'finalized');

-- CreateEnum
CREATE TYPE "RecognitionPeriodType" AS ENUM ('weekly', 'monthly');

-- CreateEnum
CREATE TYPE "AnnouncementScope" AS ENUM ('team', 'all', 'specific_teams');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('birthday', 'anniversary', 'meeting');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "employee_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department_labels" (
    "id" UUID NOT NULL,
    "department_type_key" TEXT NOT NULL,
    "work_unit_label" TEXT NOT NULL,
    "sub_unit_label" TEXT NOT NULL,
    "work_item_label" TEXT NOT NULL,
    "work_item_mode" "WorkItemMode" NOT NULL,

    CONSTRAINT "department_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "team_lead_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "department_id" UUID,
    "team_id" UUID,
    "role" "Role" NOT NULL,
    "date_of_birth" DATE,
    "date_of_joining" DATE NOT NULL,
    "base_salary" DECIMAL(12,2) NOT NULL,
    "device_uid" INTEGER,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_units" (
    "id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "team_lead_id" UUID NOT NULL,
    "status" "WorkUnitStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sub_units" (
    "id" UUID NOT NULL,
    "work_unit_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sub_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_items" (
    "id" UUID NOT NULL,
    "sub_unit_id" UUID NOT NULL,
    "assigned_to" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "mode" "WorkItemMode" NOT NULL,
    "task_points" INTEGER,
    "target_value" DECIMAL(12,2),
    "current_value" DECIMAL(12,2),
    "period_month" INTEGER,
    "period_year" INTEGER,
    "status" "WorkItemStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "work_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_task_selections" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "work_item_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_task_selections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_point_ledger" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "work_item_id" UUID NOT NULL,
    "points" INTEGER NOT NULL,
    "credited_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_point_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "clock_in_raw" TIMESTAMPTZ(6),
    "clock_out_raw" TIMESTAMPTZ(6),
    "clock_in_approved" TIMESTAMPTZ(6),
    "clock_out_approved" TIMESTAMPTZ(6),
    "total_hours" DECIMAL(4,2),
    "is_half_day" BOOLEAN NOT NULL DEFAULT false,
    "approval_status" "AttendanceApprovalStatus" NOT NULL DEFAULT 'pending',
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "source" "AttendanceSource" NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_config" (
    "id" UUID NOT NULL,
    "late_deduction_flat" DECIMAL(10,2) NOT NULL,
    "unpaid_leave_deduction_flat" DECIMAL(10,2) NOT NULL,
    "half_day_deduction_flat" DECIMAL(10,2) NOT NULL,
    "effective_from" DATE NOT NULL,

    CONSTRAINT "payroll_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslips" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "period_month" INTEGER NOT NULL,
    "period_year" INTEGER NOT NULL,
    "base_salary" DECIMAL(12,2) NOT NULL,
    "incentive_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "bonus_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "bonus_reason" TEXT,
    "other_addition_amount" DECIMAL(12,2),
    "other_addition_reason" TEXT,
    "other_deduction_amount" DECIMAL(12,2),
    "other_deduction_reason" TEXT,
    "late_count" INTEGER NOT NULL DEFAULT 0,
    "unpaid_leave_count" INTEGER NOT NULL DEFAULT 0,
    "half_day_count" INTEGER NOT NULL DEFAULT 0,
    "standard_deduction_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "reimbursement_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "employee_of_month_ref" BOOLEAN NOT NULL DEFAULT false,
    "net_pay" DECIMAL(12,2) NOT NULL,
    "generated_by" UUID NOT NULL,
    "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "PayslipStatus" NOT NULL DEFAULT 'draft',

    CONSTRAINT "payslips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requests" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "type" "RequestType" NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'pending',
    "date_from" DATE,
    "date_to" DATE,
    "amount" DECIMAL(12,2),
    "description" TEXT,
    "attachment_url" TEXT,
    "approver_id" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recognition_snapshots" (
    "id" UUID NOT NULL,
    "period_type" "RecognitionPeriodType" NOT NULL,
    "period_start" DATE NOT NULL,
    "department_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "score" DECIMAL(14,2) NOT NULL,
    "rank" INTEGER NOT NULL,
    "is_employee_of_month" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "recognition_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "scope_type" "AnnouncementScope" NOT NULL,
    "team_ids" UUID[],
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "type" "EventType" NOT NULL,
    "title" TEXT,
    "created_by" UUID,
    "scheduled_at" TIMESTAMPTZ(6),
    "reminder_lead_minutes" INTEGER,
    "employee_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_invitees" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "employee_id" UUID,
    "team_id" UUID,

    CONSTRAINT "event_invitees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_documents" (
    "id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "doc_type" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "uploaded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "assigned_to" UUID,
    "status" TEXT,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_employee_id_key" ON "users"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "department_labels_department_type_key_key" ON "department_labels"("department_type_key");

-- CreateIndex
CREATE UNIQUE INDEX "employees_email_key" ON "employees"("email");

-- CreateIndex
CREATE INDEX "work_items_assigned_to_idx" ON "work_items"("assigned_to");

-- CreateIndex
CREATE INDEX "work_items_mode_period_year_period_month_idx" ON "work_items"("mode", "period_year", "period_month");

-- CreateIndex
CREATE INDEX "daily_task_selections_employee_id_date_idx" ON "daily_task_selections"("employee_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_task_selections_employee_id_work_item_id_date_key" ON "daily_task_selections"("employee_id", "work_item_id", "date");

-- CreateIndex
CREATE INDEX "employee_point_ledger_employee_id_idx" ON "employee_point_ledger"("employee_id");

-- CreateIndex
CREATE INDEX "attendance_records_approval_status_idx" ON "attendance_records"("approval_status");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_employee_id_date_key" ON "attendance_records"("employee_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "payslips_employee_id_period_year_period_month_key" ON "payslips"("employee_id", "period_year", "period_month");

-- CreateIndex
CREATE INDEX "requests_employee_id_idx" ON "requests"("employee_id");

-- CreateIndex
CREATE INDEX "requests_type_status_idx" ON "requests"("type", "status");

-- CreateIndex
CREATE INDEX "recognition_snapshots_period_type_period_start_department_i_idx" ON "recognition_snapshots"("period_type", "period_start", "department_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "event_invitees_event_id_idx" ON "event_invitees"("event_id");

-- CreateIndex
CREATE INDEX "employee_documents_employee_id_idx" ON "employee_documents"("employee_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_team_lead_id_fkey" FOREIGN KEY ("team_lead_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_units" ADD CONSTRAINT "work_units_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_units" ADD CONSTRAINT "work_units_team_lead_id_fkey" FOREIGN KEY ("team_lead_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sub_units" ADD CONSTRAINT "sub_units_work_unit_id_fkey" FOREIGN KEY ("work_unit_id") REFERENCES "work_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_sub_unit_id_fkey" FOREIGN KEY ("sub_unit_id") REFERENCES "sub_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_task_selections" ADD CONSTRAINT "daily_task_selections_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_task_selections" ADD CONSTRAINT "daily_task_selections_work_item_id_fkey" FOREIGN KEY ("work_item_id") REFERENCES "work_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_point_ledger" ADD CONSTRAINT "employee_point_ledger_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_point_ledger" ADD CONSTRAINT "employee_point_ledger_work_item_id_fkey" FOREIGN KEY ("work_item_id") REFERENCES "work_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recognition_snapshots" ADD CONSTRAINT "recognition_snapshots_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recognition_snapshots" ADD CONSTRAINT "recognition_snapshots_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_invitees" ADD CONSTRAINT "event_invitees_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_invitees" ADD CONSTRAINT "event_invitees_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_invitees" ADD CONSTRAINT "event_invitees_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
