"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker, useNavigation, type CaptionProps } from "react-day-picker";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

// shadcn/ui Calendar (react-day-picker wrapper). Backs DatePicker
// (components/ui/date-picker.tsx). Styled to match Button/Select's visual
// language rather than react-day-picker's own defaults.
export type CalendarProps = React.ComponentProps<typeof DayPicker>;

const CURRENT_YEAR = new Date().getFullYear();
const YEARS_PER_PAGE = 12;

function pageStartFor(year: number) {
  return Math.floor(year / YEARS_PER_PAGE) * YEARS_PER_PAGE;
}

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  defaultMonth,
  // Wide enough for date-of-birth pickers (going back) without being an
  // unusable single-page year grid — callers can override either bound.
  fromYear = CURRENT_YEAR - 100,
  toYear = CURRENT_YEAR + 10,
  ...props
}: CalendarProps) {
  const [month, setMonth] = React.useState<Date>(defaultMonth ?? new Date());
  // Clicking the year in the caption swaps the day grid for a page of years
  // to pick from (in place, no native <select> chrome) — picking one drops
  // straight back into the day grid on that year.
  const [yearView, setYearView] = React.useState(false);
  const [yearPageStart, setYearPageStart] = React.useState(() => pageStartFor(month.getFullYear()));

  return (
    <div className="relative">
      <DayPicker
        showOutsideDays={showOutsideDays}
        month={month}
        onMonthChange={setMonth}
        fromYear={fromYear}
        toYear={toYear}
        className={cn("p-3", className)}
        classNames={{
          months: "flex flex-col sm:flex-row gap-2",
          month: "flex flex-col gap-4",
          caption: "flex justify-center pt-1 relative items-center w-full",
          caption_label: "text-sm font-medium",
          nav: "flex items-center gap-1",
          nav_button: cn(
            buttonVariants({ variant: "outline" }),
            "size-7 bg-transparent p-0 opacity-70 hover:opacity-100 absolute",
          ),
          nav_button_previous: "left-1",
          nav_button_next: "right-1",
          table: "w-full border-collapse space-x-1",
          head_row: "flex",
          head_cell: "text-muted-foreground rounded-md w-8 font-normal text-[0.8rem]",
          row: "flex w-full mt-2",
          cell: "relative p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-accent",
          day: cn(buttonVariants({ variant: "ghost" }), "size-8 p-0 font-normal aria-selected:opacity-100"),
          day_range_end: "day-range-end",
          day_selected:
            "bg-brand text-brand-foreground hover:bg-brand hover:text-brand-foreground focus:bg-brand focus:text-brand-foreground",
          day_today: "bg-accent text-accent-foreground",
          day_outside:
            "day-outside text-muted-foreground aria-selected:text-muted-foreground opacity-50",
          day_disabled: "text-muted-foreground opacity-50",
          day_range_middle: "aria-selected:bg-accent aria-selected:text-accent-foreground",
          day_hidden: "invisible",
          ...classNames,
        }}
        components={{
          IconLeft: () => <ChevronLeft className="size-4" />,
          IconRight: () => <ChevronRight className="size-4" />,
          Caption: (captionProps) => (
            <CalendarCaption
              {...captionProps}
              onOpenYearView={() => {
                setYearPageStart(pageStartFor(month.getFullYear()));
                setYearView(true);
              }}
            />
          ),
        }}
        {...props}
      />

      {yearView && (
        <YearGrid
          pageStart={yearPageStart}
          fromYear={fromYear}
          toYear={toYear}
          selectedYear={month.getFullYear()}
          onPrevPage={() => setYearPageStart((y) => Math.max(pageStartFor(fromYear), y - YEARS_PER_PAGE))}
          onNextPage={() => setYearPageStart((y) => Math.min(pageStartFor(toYear), y + YEARS_PER_PAGE))}
          onPick={(year) => {
            setMonth(new Date(year, month.getMonth(), 1));
            setYearView(false);
          }}
          onClose={() => setYearView(false)}
        />
      )}
    </div>
  );
}
Calendar.displayName = "Calendar";

function CalendarCaption({
  displayMonth,
  onOpenYearView,
}: CaptionProps & { onOpenYearView: () => void }) {
  const { goToMonth, previousMonth, nextMonth } = useNavigation();

  return (
    <div className="flex w-full items-center justify-center gap-1 pt-1">
      <button
        type="button"
        disabled={!previousMonth}
        onClick={() => previousMonth && goToMonth(previousMonth)}
        className={cn(
          buttonVariants({ variant: "outline" }),
          "absolute left-1 size-7 bg-transparent p-0 opacity-70 hover:opacity-100",
        )}
      >
        <ChevronLeft className="size-4" />
      </button>

      <span className="text-sm font-medium">
        {displayMonth.toLocaleString("default", { month: "long" })}
      </span>
      <button
        type="button"
        onClick={onOpenYearView}
        className="rounded-md px-1.5 py-0.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
      >
        {displayMonth.getFullYear()}
      </button>

      <button
        type="button"
        disabled={!nextMonth}
        onClick={() => nextMonth && goToMonth(nextMonth)}
        className={cn(
          buttonVariants({ variant: "outline" }),
          "absolute right-1 size-7 bg-transparent p-0 opacity-70 hover:opacity-100",
        )}
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}

function YearGrid({
  pageStart,
  fromYear,
  toYear,
  selectedYear,
  onPrevPage,
  onNextPage,
  onPick,
  onClose,
}: {
  pageStart: number;
  fromYear: number;
  toYear: number;
  selectedYear: number;
  onPrevPage: () => void;
  onNextPage: () => void;
  onPick: (year: number) => void;
  onClose: () => void;
}) {
  const years = Array.from({ length: YEARS_PER_PAGE }, (_, i) => pageStart + i);

  return (
    <div className="absolute inset-0 z-20 flex flex-col gap-3 rounded-md bg-popover p-3 text-popover-foreground">
      <div className="flex items-center justify-center gap-1">
        <button
          type="button"
          disabled={pageStart <= pageStartFor(fromYear)}
          onClick={onPrevPage}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "absolute left-1 size-7 bg-transparent p-0 opacity-70 hover:opacity-100 disabled:opacity-30",
          )}
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="text-sm font-medium">
          {years[0]}–{years[years.length - 1]}
        </span>
        <button
          type="button"
          disabled={pageStart + YEARS_PER_PAGE > pageStartFor(toYear) + YEARS_PER_PAGE}
          onClick={onNextPage}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "absolute right-1 size-7 bg-transparent p-0 opacity-70 hover:opacity-100 disabled:opacity-30",
          )}
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      <div className="grid grow grid-cols-3 gap-1.5">
        {years.map((year) => {
          const inRange = year >= fromYear && year <= toYear;
          const isSelected = year === selectedYear;
          return (
            <button
              key={year}
              type="button"
              disabled={!inRange}
              onClick={() => onPick(year)}
              className={cn(
                buttonVariants({ variant: isSelected ? "default" : "ghost" }),
                "h-9 p-0 font-normal tabular-nums",
                isSelected && "bg-brand text-brand-foreground hover:bg-brand hover:text-brand-foreground",
                !inRange && "opacity-30",
              )}
            >
              {year}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onClose}
        className="self-center text-xs text-muted-foreground hover:text-foreground hover:underline"
      >
        Cancel
      </button>
    </div>
  );
}

export { Calendar };
