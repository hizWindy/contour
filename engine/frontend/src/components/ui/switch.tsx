import * as React from "react"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/*
  The track is 24px tall (the smallest click target) with an 8px radius, so it is a rounded
  rectangle and not a pill. The thumb is a small rounded square. A switch that is on takes the
  accent (DESIGN.md "Colour"), and the thumb slides on the soft spring (tokens.css "Motion").
*/
const TRACK =
  "peer inline-flex h-6 w-10 shrink-0 items-center rounded-md border border-transparent p-0.5 transition-colors aria-invalid:border-destructive data-checked:bg-accent-strong data-unchecked:bg-input data-disabled:cursor-not-allowed data-disabled:opacity-50"
const THUMB =
  "pointer-events-none block size-4 rounded-sm bg-card transition-transform duration-(--duration-soft) ease-spring-soft data-checked:translate-x-4.5 data-checked:bg-primary-foreground data-unchecked:translate-x-0"

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(TRACK, className)}
      {...props}
    >
      <SwitchPrimitive.Thumb data-slot="switch-thumb" className={THUMB} />
    </SwitchPrimitive.Root>
  )
}

/*
  The same switch, drawn only, for a row that is itself the control, like a menu row that turns
  something on or off ("Use V to speak", PLAN-V23 T4-1). The row says on or off to a screen
  reader, so this is hidden from it.
*/
function SwitchMark({
  checked,
  className,
}: {
  checked: boolean
  className?: string
}) {
  const state = checked ? "checked" : "unchecked"
  return (
    <span
      aria-hidden="true"
      data-slot="switch-mark"
      data-state={state}
      className={cn(TRACK, className)}
    >
      <span data-state={state} className={THUMB} />
    </span>
  )
}

export { Switch, SwitchMark }
