import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { FINANCE_ROLES } from "@/lib/rbac";
import { ReviewQueueScreen } from "@/components/work/review-queue-screen";

// Lead review inbox (Pillar 2, 2026-08-08). Deliberately gated only on "has an
// employee record" rather than on role: a WorkUnit's project lead can be any
// role, and GET /work-items/review-queue already self-scopes to the units the
// caller leads (Admin/HR see everything, everyone else sees an empty list).
export default async function WorkReviewPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.employeeId && !FINANCE_ROLES.includes(session.role)) redirect("/");
  return <ReviewQueueScreen />;
}
