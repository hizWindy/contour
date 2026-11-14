/**
 * The run page's goal (PLAN-V16 T3-3): "12 of 20" good leads found, as the biggest number on the
 * card with a bar, and how the run ended against it; and where its leads came from (the web, and
 * the two property tools).
 */
import { CircleCheck, TriangleAlert } from 'lucide-react'
import type { Run } from '@/api/types'
import { Progress } from '@/components/ui/progress'
import { formatNumber } from '@/lib/format'
import { leadSources, type GoalProgress } from './goal-data'

export function GoalBlock({ progress }: { progress: GoalProgress }) {
  const { state, goal, found, share, why } = progress
  const words = `${formatNumber(found)} of ${formatNumber(goal)}`
  return (
    // A line under it keeps its bar apart from the companies bar that follows.
    <div data-slot="run-goal" className="flex flex-col gap-2 border-b pb-4">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-title font-semibold tabular-nums">{words}</span>
        <span className="text-ui text-muted-foreground">good leads found</span>
      </p>
      <Progress
        value={share}
        aria-label="Good leads found"
        aria-valuetext={`${words} good leads found`}
      />
      {state === 'met' ? (
        <p className="flex items-start gap-2 text-ui text-pass-ink">
          <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          It met its goal.
        </p>
      ) : null}
      {state === 'short' && why ? (
        <p className="flex items-start gap-2 text-ui text-review-ink">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {why}
        </p>
      ) : null}
    </div>
  )
}

/** "Where the leads came from: The web 9, Property Daily 2, Arealytics 1." Nothing with none. */
export function LeadSourcesLine({ run }: { run: Run }) {
  const sources = leadSources(run)
  if (sources.length === 0) {
    return null
  }
  return (
    <div className="flex flex-col gap-1">
      <p id="run-lead-sources" className="text-caption text-muted-foreground">
        Where the leads came from
      </p>
      <ul aria-labelledby="run-lead-sources" className="flex flex-wrap gap-x-4 gap-y-1 text-ui">
        {sources.map((source) => (
          <li key={source.id}>
            {source.label}{' '}
            <span className="font-semibold tabular-nums">{formatNumber(source.count)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
