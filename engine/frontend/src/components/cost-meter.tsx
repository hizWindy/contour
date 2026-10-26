import { OctagonAlert, TriangleAlert } from 'lucide-react'
import type { RunStatus } from '@/api/types'
import { costStanding } from '@/lib/cost'
import { formatPercent } from '@/lib/format'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'

export interface CostMeterProps {
  /** What the run has cost, a Decimal string in US dollars. */
  cost: string | null | undefined
  /** The most the run may cost, a Decimal string in US dollars. */
  cap: string | null | undefined
  /** The run's status. It sets `atLeast` and `live` when those are not given. */
  status?: RunStatus
  /**
   * Says "At least" in front of the cost. A run that was stopped, failed or was interrupted may
   * miss a request that was cut off, so its real cost can be a little higher. Default: true for
   * those three statuses.
   */
  atLeast?: boolean
  /** Fills the bar in Navy, because the run is going. Default: true for a queued or running run. */
  live?: boolean
  className?: string
}

const FILL: Record<'ok' | 'near' | 'over', string> = {
  ok: 'bg-muted-foreground',
  near: 'bg-review',
  over: 'bg-destructive',
}

/**
 * The cost of a run against its cap, as words and a bar. The bar is Navy while the run is going,
 * Ochre when the cost is within 20% of the cap, and Terracotta when it is over. The state is
 * also written ("Close to the cap", "Over the cap") and has an icon, so colour is never the only
 * signal.
 */
export function CostMeter({ cost, cap, status, atLeast, live, className }: CostMeterProps) {
  const { percent, state } = costStanding(cost, cap)
  const showAtLeast =
    atLeast ?? (status === 'cancelled' || status === 'interrupted' || status === 'failed')
  const isLive = live ?? (status === 'running' || status === 'queued')
  const shown = percent === null ? 0 : Math.min(100, Math.max(0, percent))
  const costText = `${showAtLeast ? 'At least ' : ''}${formatMoney(cost)}`
  const capText = formatMoney(cap)
  const fill = state === 'ok' && isLive ? 'bg-primary' : FILL[state]
  const stateText = state === 'over' ? 'Over the cap' : state === 'near' ? 'Close to the cap' : null
  const StateIcon = state === 'over' ? OctagonAlert : TriangleAlert

  return (
    <div data-slot="cost-meter" data-state={state} className={cn('flex flex-col gap-2', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-ui">
        <p>
          <span className="font-semibold tabular-nums">{costText}</span>
          <span className="text-muted-foreground tabular-nums"> of {capText} cap</span>
        </p>
        <p
          className={cn(
            'inline-flex items-center gap-1 tabular-nums',
            state === 'over'
              ? 'font-semibold text-destructive-ink'
              : state === 'near'
                ? 'font-semibold text-review-ink'
                : 'text-muted-foreground',
          )}
        >
          {stateText ? <StateIcon aria-hidden="true" className="size-4" /> : null}
          {stateText ? `${stateText}, ` : null}
          {percent === null ? 'No cap set' : `${formatPercent(percent)} of the cap`}
        </p>
      </div>
      <div
        role="meter"
        aria-label="Cost against the cap"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(shown)}
        aria-valuetext={`${costText} of ${capText} cap${stateText ? `. ${stateText}` : ''}`}
        className="h-2 w-full overflow-hidden rounded-xs bg-muted"
      >
        <div
          className={cn('h-full transition-[width] duration-250', fill)}
          style={{ width: `${shown}%` }}
        />
      </div>
    </div>
  )
}
