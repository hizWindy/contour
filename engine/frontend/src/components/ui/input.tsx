import * as React from "react"

import { cn } from "@/lib/utils"

/* 36px field with the 3:1 form border (--input). The focus ring is the global one. */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-lg border border-input bg-card px-3 py-1 text-ui text-foreground transition-colors file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-ui file:font-semibold file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
