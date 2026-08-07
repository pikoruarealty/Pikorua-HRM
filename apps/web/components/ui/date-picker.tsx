"use client";

import * as React from "react";
import { CalendarIcon } from "lucide-react";
import { format, parse, isValid } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// shadcn/ui-style DatePicker — drop-in replacement for `<Input type="date">`.
// Same string contract as the native input (`value`/`onChange` in
// "YYYY-MM-DD", "" for empty) so call sites don't need to change their state
// shape, just swap the element.
export function DatePicker({
  id,
  value,
  onChange,
  placeholder = "Pick a date",
  min,
  max,
  disabled,
  className,
  required,
}: {
  id?: string;
  /** "YYYY-MM-DD", or "" for no value — mirrors native `<input type="date">`. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** "YYYY-MM-DD" lower bound, inclusive. */
  min?: string;
  /** "YYYY-MM-DD" upper bound, inclusive. */
  max?: string;
  disabled?: boolean;
  className?: string;
  required?: boolean;
}) {
  const [open, setOpen] = React.useState(false);

  const selected = value ? parse(value, "yyyy-MM-dd", new Date()) : undefined;
  const validSelected = selected && isValid(selected) ? selected : undefined;
  const minDate = min ? parse(min, "yyyy-MM-dd", new Date()) : undefined;
  const maxDate = max ? parse(max, "yyyy-MM-dd", new Date()) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-required={required}
          className={cn(
            "h-10 w-full justify-start gap-2 px-3 text-left font-normal",
            !validSelected && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="size-4 shrink-0 opacity-60" />
          {validSelected ? format(validSelected, "dd MMM yyyy") : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={validSelected}
          defaultMonth={validSelected}
          onSelect={(d) => {
            onChange(d ? format(d, "yyyy-MM-dd") : "");
            setOpen(false);
          }}
          disabled={
            minDate || maxDate
              ? (d: Date) => (minDate ? d < minDate : false) || (maxDate ? d > maxDate : false)
              : undefined
          }
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
