-- Session revocation: bumped on password change / deactivation to invalidate
-- outstanding JWTs (see apps/web/lib/auth/session.ts).
ALTER TABLE "users" ADD COLUMN "token_version" INTEGER NOT NULL DEFAULT 0;

-- Credit an atomic WorkItem's task points at most once, so a concurrent
-- double-complete fails the second insert instead of double-crediting.
CREATE UNIQUE INDEX "employee_point_ledger_work_item_id_key" ON "employee_point_ledger"("work_item_id");
