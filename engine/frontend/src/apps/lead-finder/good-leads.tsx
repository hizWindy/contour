/**
 * "3 good leads, US$1.20 each" (PLAN-V9 D2). The run page, the Runs list and the Home card all say
 * it the same way. The sums are in good-leads-data.ts.
 */
import type { RunCounts } from '@/api/types'
import { Money } from '@/components/money'
import { pluralise } from '@/lib/format'
import { costPerGoodLead, goodLeads, NO_GOOD_LEADS } from './good-leads-data'

export function GoodLeadsLine({
  counts,
  cost,
  className,
}: {
  counts: Pick<RunCounts, 'by_result'>
  cost: string
  className?: string
}) {
  const good = goodLeads(counts)
  const each = costPerGoodLead(cost, good)
  if (each === null) {
    return <span className={className}>{NO_GOOD_LEADS}</span>
  }
  return (
    <span className={className}>
      {pluralise(good, 'good lead')}, <Money value={each} /> each
    </span>
  )
}
