import { SalesTeamProgressPanel } from "@/components/sales/sales-team-progress-panel";
import { OfflineClaimsPanel } from "@/components/sales/offline-claims-panel";

// The /sales page (Pillar 5, 2026-08-10). Two panels, deliberately on one
// screen: what the numbers currently say, and the mechanism for correcting the
// one thing the CRM cannot see. A rep viewing this sees only their own row —
// the progress route scopes server-side.
export function SalesScreen({
  employeeId,
  canReview,
  canClaim,
}: {
  employeeId: string | null;
  canReview: boolean;
  /** Only the sales side files claims. Admin/HR review them but have no calls
   *  of their own to claim, so they get the queue without the form — the same
   *  "oversee rather than do" line the nav already draws for Admin. */
  canClaim: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      <SalesTeamProgressPanel canSync={canReview} />
      <OfflineClaimsPanel
        employeeId={employeeId}
        canReview={canReview}
        canClaim={canClaim}
      />
    </div>
  );
}
