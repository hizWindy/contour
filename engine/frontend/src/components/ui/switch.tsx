import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/*
  The track is 24px tall (the smallest click target) with an 8px radius, so it is a rounded
  rectangle and not a pill. The thumb is a small rounded square. A switch that is on takes the
  accent (DESIGN.md "Colour"), and the thumb slides on the soft spring (tokens.css "Motion").
*/
function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-6 w-10 shrink-0 items-center rounded-md border border-transparent p-0.5 transition-colors aria-invalid:border-destructive data-checked:bg-accent-strong data-unchecked:bg-input data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 rounded-sm bg-card transition-transform duration-(--duration-soft) ease-spring-soft data-checked:translate-x-4.5 data-checked:bg-primary-foreground data-unchecked:translate-x-0"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
