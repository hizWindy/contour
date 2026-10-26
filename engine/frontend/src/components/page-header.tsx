import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface PageHeaderProps {
  /** The page title. It is the page's one `h1`. */
  title: string
  /** One plain sentence under the title. */
  description?: ReactNode
  /** Buttons for the page, on the right. */
  actions?: ReactNode
  className?: string
}

/** The title of a page: 24px semibold, with an optional line under it and actions at the end. */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <header
      data-slot="page-header"
      className={cn('flex flex-wrap items-start justify-between gap-4', className)}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-title font-semibold text-foreground">{title}</h1>
        {description ? (
          <p className="max-w-prose text-ui text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}
