import * as React from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { DayPicker, getDefaultClassNames } from "react-day-picker";
import { zhCN } from "react-day-picker/locale/zh-CN";

import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";

/**
 * shadcn/ui `calendar` (new-york), sized down for the island: the default
 * 2rem cells and 3rem padding are too tall for a 480px floating panel. All
 * styles come from Tailwind utilities, so react-day-picker's stylesheet is
 * not imported (it would fight the island's cascade layers).
 */
function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  buttonVariant = "ghost",
  components,
  ...props
}: React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>["variant"];
}) {
  const defaults = getDefaultClassNames();

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      locale={zhCN}
      className={cn(
        "group/calendar w-fit rounded-lg border border-border bg-popover/85 p-2 text-[11px] shadow-xl shadow-black/40 [--cell-size:26px]",
        className,
      )}
      classNames={{
        root: cn("w-fit", defaults.root),
        months: cn("relative flex flex-col gap-1", defaults.months),
        month: cn("flex w-full flex-col gap-1", defaults.month),
        nav: cn(
          "absolute inset-x-0 top-0 flex items-center justify-between",
          defaults.nav,
        ),
        button_previous: cn(
          buttonVariants({ variant: buttonVariant }),
          "size-[var(--cell-size)] p-0",
          defaults.button_previous,
        ),
        button_next: cn(
          buttonVariants({ variant: buttonVariant }),
          "size-[var(--cell-size)] p-0",
          defaults.button_next,
        ),
        month_caption: cn(
          "flex h-[var(--cell-size)] w-full items-center justify-center",
          defaults.month_caption,
        ),
        caption_label: cn(
          "select-none text-[11px] font-semibold",
          defaults.caption_label,
        ),
        month_grid: cn("w-full border-collapse", defaults.month_grid),
        weekdays: cn("flex", defaults.weekdays),
        weekday: cn(
          "flex-1 select-none text-center text-[10px] font-normal text-muted-foreground",
          defaults.weekday,
        ),
        weeks: cn("flex flex-col", defaults.weeks),
        week: cn("flex w-full", defaults.week),
        day: cn(
          "group/day relative aspect-square size-full select-none p-0 text-center",
          defaults.day,
        ),
        day_button: cn(
          buttonVariants({ variant: buttonVariant }),
          "size-[var(--cell-size)] rounded-md p-0 text-[11px] font-normal aria-selected:opacity-100",
          defaults.day_button,
        ),
        selected: cn(
          "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary/85",
          defaults.selected,
        ),
        today: cn(
          "[&>button]:text-primary [&>button]:ring-1 [&>button]:ring-primary/50",
          defaults.today,
        ),
        outside: cn("text-muted-foreground/40", defaults.outside),
        disabled: cn("opacity-40", defaults.disabled),
        hidden: cn("invisible", defaults.hidden),
        ...classNames,
      }}
      components={{
        Chevron: ({ className: iconClass, orientation }) => {
          if (orientation === "left") {
            return <ChevronLeft className={cn("size-3.5", iconClass)} />;
          }
          if (orientation === "right") {
            return <ChevronRight className={cn("size-3.5", iconClass)} />;
          }
          if (orientation === "up") {
            return <ChevronUp className={cn("size-3.5", iconClass)} />;
          }
          return <ChevronDown className={cn("size-3.5", iconClass)} />;
        },
        ...components,
      }}
      {...props}
    />
  );
}

export { Calendar };
