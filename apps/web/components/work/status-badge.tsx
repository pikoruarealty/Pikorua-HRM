import { Badge } from "@/components/ui/badge";

// One place that turns a WorkItemStatus into a human label + colour, so the
// employee list, the planning screen and the lead's project view can't drift
// apart on how `in_review` reads (Pillar 2, 2026-08-08). Raw enum values were
// rendered before; `in_review` is the first status whose bare name would be
// confusing to an employee, so all four now get a proper label.

const LABELS: Record<string, string> = {
  pending: "Pending",
  wip: "In progress",
  in_review: "Awaiting review",
  completed: "Completed",
};

const VARIANTS: Record<string, "outline" | "warning" | "success"> = {
  in_review: "warning",
  completed: "success",
};

export function statusLabel(status: string): string {
  return LABELS[status] ?? status;
}

export function WorkItemStatusBadge({ status }: { status: string }) {
  return <Badge variant={VARIANTS[status] ?? "outline"}>{statusLabel(status)}</Badge>;
}
