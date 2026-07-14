import { PayrollConfig } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

// Track A. payroll_config is versioned by effective_from — never overwrite a
// historical row (SCHEMA.md §4, TRACK_A_TASKS.md Milestone 3), so a payslip
// generated for a past period stays reproducible even after rates change.

/** The config row effective for a given payroll period (month is 1-12) —
 *  the most recent row whose effective_from is on/before the period start. */
export async function getEffectivePayrollConfig(
  month: number,
  year: number,
): Promise<PayrollConfig | null> {
  const periodStart = new Date(Date.UTC(year, month - 1, 1));
  return prisma.payrollConfig.findFirst({
    where: { effectiveFrom: { lte: periodStart } },
    orderBy: { effectiveFrom: "desc" },
  });
}

export async function getLatestPayrollConfig(): Promise<PayrollConfig | null> {
  return prisma.payrollConfig.findFirst({ orderBy: { effectiveFrom: "desc" } });
}
