import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Icon-only action button with a tooltip carrying the full label (2026-09-24
// — replaces the text-label Button rows in dense action columns like
// Attendance and Requests, which overflowed into horizontal scroll). `label`
// both drives the tooltip and the button's aria-label, so an icon-only
// control never loses its accessible name.
//
// Kept out of the plain `Button` component on purpose: a row of 3-4 of these
// is a different visual weight than the app's ordinary text-label buttons
// (forms, single standalone actions), and collapsing every button in the app
// to icon-only would trade one readability problem for another — this is
// specifically for repeated per-row actions in a table.
export const IconActionButton = React.forwardRef<
  HTMLButtonElement,
  Omit<ButtonProps, "size"> & { icon: LucideIcon; label: string; size?: "sm" | "default" }
>(({ icon: Icon, label, variant = "outline", size = "sm", className, ...props }, ref) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        ref={ref}
        type="button"
        variant={variant}
        size="icon"
        aria-label={label}
        className={cn(size === "sm" ? "size-8" : "size-10", className)}
        {...props}
      >
        <Icon className="size-4" aria-hidden />
      </Button>
    </TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>
));
IconActionButton.displayName = "IconActionButton";
