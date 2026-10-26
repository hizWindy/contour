import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/*
  Badges are never round (8px radius). A badge puts a dark step of its colour on a light tint of
  the same colour, and always carries an icon and a word, so colour is never the only signal.
  Results: pass (Olive), review (Ochre, Director review), watch (Sand), drop (grey outline).
  HubSpot labels use outline. Navy is not a badge colour.
*/
const badgeVariants = cva(
  "inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-md border px-2 text-caption font-semibold whitespace-nowrap transition-colors aria-invalid:border-destructive [&>svg]:pointer-events-none [&>svg]:size-3.5",
  {
    variants: {
      variant: {
        default: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-input bg-transparent text-foreground",
        pass: "border-pass bg-pass-soft text-pass-ink",
        review: "border-review bg-review-soft text-review-ink",
        watch: "border-watch bg-watch-soft text-watch-ink",
        drop: "border-input bg-transparent text-muted-foreground",
        destructive:
          "border-destructive bg-destructive-soft text-destructive-ink",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
