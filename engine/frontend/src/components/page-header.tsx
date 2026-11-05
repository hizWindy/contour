import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { TONE_CLASSES, type ProjectTone } from '@/shell/tone'

export interface PageHeaderProps {
  /** The page title. It is the page's one `h1`. */
  title: string
  /** One plain sentence under the title. */
  description?: ReactNode
  /** Buttons for the page, on the right. */
  actions?: ReactNode
  /** The page's icon from the menu, in a tile beside the title. */
  icon?: LucideIcon
  /** The project's colour for that tile (DESIGN.md "Project colour"). Without it the tile is Stone. */
  tone?: ProjectTone
  className?: string
}

/** The title of a page: 24px semibold, with an optional line under it and actions at the end. */
export function PageHeader({
  title,
  description,
  actions,
  icon: Icon,
  tone,
  className,
}: PageHeaderProps) {
  return (
    <header
      data-slot="page-header"
      className={cn('flex flex-wrap items-start justify-between gap-4', className)}
    >
      <div className="flex min-w-0 items-start gap-3">
        {Icon ? (
          <span
            aria-hidden="true"
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-lg',
              tone ? TONE_CLASSES[tone].tile : 'bg-secondary text-muted-foreground',
            )}
          >
            <Icon className="size-5" />
          </span>
        ) : null}
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-title font-semibold text-foreground">{title}</h1>
          {description ? (
            <p className="max-w-prose text-ui text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}
