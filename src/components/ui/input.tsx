import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, onWheel, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      // Chrome/Firefox change a focused number input's value when the user
      // scrolls over it (by `step`, silently, with no visual feedback) —
      // a well-known browser footgun, not something anyone here ever
      // wants. Confirmed as the real cause of a ₺30.000 tutar saving as
      // ₺29.999,98 (autoFocus on the amount field in
      // src/components/ledger/QuickEntryForm.tsx keeps it focused while
      // the user scrolls the sheet — exactly step=0.01 × 2). Blurring on
      // wheel makes the scroll act on the page normally instead.
      onWheel={
        type === "number"
          ? (e) => {
              (e.target as HTMLInputElement).blur();
              onWheel?.(e);
            }
          : onWheel
      }
      data-slot="input"
      className={cn(
        // h-touch, not h-8: every input in this app is a mobile tap target
        // (CLAUDE.md rule 4, ≥48px) — there's no context here where a small
        // desktop-density input is the right call.
        "h-touch w-full min-w-0 rounded-lg border border-input bg-transparent px-3 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
