/**
 * The source chip (PLAN-V10 F1): a source's id (F3, W1), with its label and date in a tooltip,
 * and a link for a web page. Call prep's script lines show them (`guide-parts.tsx`), and so do
 * the pre-read's summaries (PLAN-V17 T3-10). In a file of its own, so a page that only needs the
 * chips doesn't bring the script's icons with it.
 */
import type { PrepSource } from '@/api/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatDate } from '@/lib/format'
import { safeHref } from '@/lib/safe-href'

/** A source id (F3, W1) with its label in a tooltip, and a link for a web page. */
export function SourceChip({ id, source }: { id: string; source: PrepSource | undefined }) {
  const href = safeHref(source?.url)
  const chip = (
    <span className="inline-flex h-5 items-center rounded-sm border border-input px-1 text-caption leading-none font-semibold text-muted-foreground tabular-nums">
      {id}
    </span>
  )
  const what = source
    ? `${source.label}${source.date ? `, ${formatDate(source.date)}` : ''}`
    : 'A source'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="rounded-sm transition-opacity hover:opacity-80"
          >
            {chip}
            <span className="sr-only">Source: {what}</span>
          </a>
        ) : (
          <span tabIndex={0} className="rounded-sm">
            {chip}
            <span className="sr-only">Source: {what}</span>
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent>{what}</TooltipContent>
    </Tooltip>
  )
}
