import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-8 w-full rounded-md border border-input bg-transparent px-2.5 py-1 text-xs text-foreground shadow-sm outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring/70 focus-visible:ring-2 focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:opacity-50",
        // WebKit's number spinners and the date/time pickers need to stay
        // legible on the near-black island surface.
        "[&::-webkit-inner-spin-button]:opacity-40 [&::-webkit-calendar-picker-indicator]:invert [&::-webkit-calendar-picker-indicator]:opacity-55",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
