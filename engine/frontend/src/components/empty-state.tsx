import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface EmptyStateProps {
  /** One plain sentence, in the serif voice: "No leads yet." */
  title: string
  /** What to do next, in plain words: "Start a run to see companies here." */
  description?: ReactNode
  icon?: LucideIcon
  /** A button or link for the next step. */
  action?: ReactNode
  /** The level of the title. Default 2. Use 1 when the empty state is the whole page. */
  headingLevel?: 1 | 2 | 3 | 4
  className?: string
}

/**
 * What a list or page shows when there is nothing to show. It speaks in the serif typeface
 * (IBM Plex Serif is for empty states, the welcome and quotes only), is left-aligned like all
 * text, and always says what to do next.
 */
export function EmptyState({
  title,
  description,
  icon: Icon,
  action,
  headingLevel = 2,
  className,
}: EmptyStateProps) {
  const Heading = `h${headingLevel}` as const
  return (
    <section
      data-slot="empty-state"
      className={cn('flex flex-col items-start gap-2 rounded-lg border bg-card p-6', className)}
    >
      {Icon ? <Icon aria-hidden="true" className="size-5 text-muted-foreground" /> : null}
      <Heading className="font-serif text-section text-foreground">{title}</Heading>
      {description ? (
        <p className="max-w-prose text-ui text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </section>
  )
}
