/**
 * The source mark of the Companies page (PLAN-V13 T2-8): an icon and a word in quiet text, with
 * a tooltip, as DESIGN.md says for source marks. HubSpot, Lead Finder or Both (`source-words.ts`).
 * Only people with the Lead Finder tick see it; for everyone else every company is from HubSpot.
 */
import type { CompanyRow } from '@/api/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { companySource, SOURCE_MARKS } from './source-words'

export function CompanySource({
  row,
  className,
}: {
  row: Pick<CompanyRow, 'source' | 'lead_result'>
  className?: string
}) {
  const kind = companySource(row)
  const { label, hint, icon: Icon } = SOURCE_MARKS[kind]
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-source={kind}
          className={cn(
            'inline-flex w-fit shrink-0 items-center gap-1 text-caption whitespace-nowrap text-muted-foreground',
            className,
          )}
        >
          <Icon aria-hidden="true" className="size-3.5" />
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  )
}
