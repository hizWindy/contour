import { ExternalLink } from 'lucide-react'
import { hostOf, safeHref } from '@/lib/safe-href'
import { cn } from '@/lib/utils'

export interface SourceLinkProps {
  /** The address from the backend. Only an http or https address becomes a link. */
  href: string | null | undefined
  /** Text to show instead of the host, like the page title. The host is still shown after it. */
  label?: string
  className?: string
}

/**
 * A link to a source, drawn the one safe way: only http and https addresses become links, it
 * opens in a new tab with `noopener noreferrer nofollow`, and it shows the host (`afr.com`) so a
 * person sees where it goes. An address that is not a plain web address is shown as text, never
 * as a link.
 */
export function SourceLink({ href, label, className }: SourceLinkProps) {
  const safe = safeHref(href)
  const host = hostOf(href)
  if (safe === null || host === null) {
    return (
      <span data-slot="source-link" className={cn('text-muted-foreground', className)}>
        {label ?? (typeof href === 'string' && href !== '' ? href : 'No link')}
        <span className="sr-only"> (not a web link)</span>
      </span>
    )
  }
  return (
    <a
      data-slot="source-link"
      href={safe}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-sm text-foreground underline underline-offset-4 hover:text-muted-foreground',
        className,
      )}
    >
      {label ? <span className="truncate">{label}</span> : null}
      <span className={cn('truncate', label ? 'text-muted-foreground' : undefined)}>
        {label ? `(${host})` : host}
      </span>
      <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}
