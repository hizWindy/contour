import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Toggle as TogglePrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

/* A pressed toggle shows the selected tint, so it is not told apart by colour alone: the
   label and aria-pressed carry the state too. */
const toggleVariants = cva(
  "group/toggle inline-flex items-center justify-center gap-2 rounded-lg text-ui whitespace-nowrap transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive data-[state=on]:bg-selected data-[state=on]:text-selected-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "border border-transparent bg-transparent",
        outline:
          "border border-input bg-transparent data-[state=on]:border-primary",
      },
      size: {
        default: "h-9 min-w-9 px-3 touch:h-11 touch:min-w-11",
        sm: "h-8 min-w-8 px-2.5 touch:h-10 touch:min-w-10",
        lg: "h-10 min-w-10 px-4 touch:h-12 touch:min-w-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
