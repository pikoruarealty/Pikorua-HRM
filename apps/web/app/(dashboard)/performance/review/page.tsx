import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES, LEAD_ROLES } from "@/lib/rbac";
import { PerformanceReviewScreen } from "@/components/performance/performance-review-screen";

// Lead monthly-review sheet (Pillar 3, 2026-08-08). Unlike /work/review — where
// a project lead can be any role — reviewing a person is tied to actual team
// leadership, so the page is gated on Lead/Admin/HR up front and
// GET /performance-reviews/queue re-scopes to the caller's own team anyway.
export default async function PerformanceReviewPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!FINANCE_ROLES.includes(session.role) && !LEAD_ROLES.includes(session.role)) redirect("/");
  return <PerformanceReviewScreen />;
}
