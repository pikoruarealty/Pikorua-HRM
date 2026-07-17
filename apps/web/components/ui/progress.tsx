import * as React from "react";
import { cn } from "@/lib/utils";

// SHARED shadcn-style primitive (2026-07-17): a plain determinate progress
// bar, no dependency added. `value` is a percentage 0-100.
export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number;
}

function Progress({ value, className, ...props }: ProgressProps) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}
      {...props}
    >
      <div
        className="h-full overflow-hidden rounded-full bg-brand transition-all"
        style={{ width: `${clamped}%` }}
      >
        <div className="h-full w-full animate-shimmer bg-[linear-gradient(110deg,transparent_30%,rgba(255,255,255,0.4)_50%,transparent_70%)] bg-[length:200%_100%]" />
      </div>
    </div>
  );
}

export { Progress };
