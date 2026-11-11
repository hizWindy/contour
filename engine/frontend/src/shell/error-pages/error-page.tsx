import type { LucideIcon } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import type { ApiProblem } from '@/api/client'
import { SupportDetails } from '@/components/support-details'
import { cn } from '@/lib/utils'

export interface ErrorPageProps {
  icon: LucideIcon
  /** The page's `h1`, from "Words for errors". */
  title: string
  /** What it means and what to do. */
  description: ReactNode
  /** A line that changes by itself, like "Checking again in 7 seconds." Read out politely. */
  live?: ReactNode
  /** The buttons: Try again, Go to Home, Reload. */
  actions?: ReactNode
  /** When set, "Details for support" is folded under the buttons. */
  problem?: ApiProblem
  /**
   * Outside the app frame (no menu, no top bar): the page fills the screen and centres the card.
   * Used when the app can't be shown at all, like "who is signed in" failing.
   */
  standalone?: boolean
  /** `alert` for a failure, `status` for a calm page (updating, reloading). */
  role?: 'alert' | 'status'
}

/**
 * The layout every full error page shares (PLAN-V15 T2-4): an icon, the title as the page's
 * heading, one or two plain sentences, the buttons, and the folded details for support. Calm and
 * left-aligned like the rest of the site, never a red screen: it is a card on the page.
 */
export function ErrorPage({
  icon: Icon,
  title,
  description,
  live,
  actions,
  problem,
  standalone = false,
  role = 'alert',
}: ErrorPageProps) {
  const headingId = useId()
  const card = (
    <section
      role={role}
      aria-labelledby={headingId}
      data-slot="error-page"
      className={cn(
        'flex w-full flex-col items-start gap-3 rounded-lg border bg-card p-6 text-card-foreground',
        standalone ? 'max-w-xl' : 'max-w-2xl',
      )}
    >
      <Icon aria-hidden="true" className="size-6 text-muted-foreground" />
      <h1 id={headingId} className="text-title font-semibold text-foreground">
        {title}
      </h1>
      <p className="max-w-prose text-body text-muted-foreground">{description}</p>
      {live ? (
        <p aria-live="polite" className="text-ui text-muted-foreground">
          {live}
        </p>
      ) : null}
      {actions ? <div className="mt-2 flex flex-wrap gap-2">{actions}</div> : null}
      {problem ? <SupportDetails problem={problem} className="mt-2 text-muted-foreground" /> : null}
    </section>
  )
  if (!standalone) {
    return card
  }
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-4 sm:p-6">
      {card}
    </main>
  )
}
