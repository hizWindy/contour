/**
 * The parts of the Company cell: the name with its marks, and on the review page (PLAN-V9 C3) the
 * tick boxes. A tick box stops the row's own click, which would open the lead.
 */
import type { LeadRow } from '@/api/types'
import { SourceMark } from '@/components/source-mark'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'

/** The tick boxes of the review page: which leads are ticked, and how to change that. */
export interface Tick {
  selected: ReadonlySet<string>
  pageIds: readonly string[]
  onToggle: (id: string, on: boolean) => void
  onTogglePage: (on: boolean) => void
}

/** Stops the row's own click (which opens the lead) when the tick box is clicked. */
function stop(event: { stopPropagation: () => void }): void {
  event.stopPropagation()
}

export function PageTick({
  tick,
  label = 'Tick every lead on this page',
}: {
  tick: Tick
  label?: string
}) {
  const ticked = tick.pageIds.filter((id) => tick.selected.has(id)).length
  const all = ticked > 0 && ticked === tick.pageIds.length
  return (
    <Checkbox
      aria-label={label}
      checked={all ? true : ticked > 0 ? 'indeterminate' : false}
      disabled={tick.pageIds.length === 0}
      onCheckedChange={(next) => {
        tick.onTogglePage(next === true)
      }}
    />
  )
}

export function RowTick({ tick, id, name }: { tick: Tick; id: string; name: string }) {
  return (
    <span className="pt-0.5" onClick={stop} onKeyDown={stop}>
      <Checkbox
        aria-label={`Tick ${name}`}
        checked={tick.selected.has(id)}
        onCheckedChange={(next) => {
          tick.onToggle(id, next === true)
        }}
      />
    </span>
  )
}

export function CompanyName({
  name,
  points,
  city,
  isTest,
  origin,
}: {
  name: string
  points: string
  city: string | null
  isTest: boolean
  origin: LeadRow['origin']
}) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="flex items-center gap-2">
        <button
          type="button"
          className="min-w-0 truncate rounded-sm text-left font-semibold underline-offset-4 hover:underline"
        >
          {name}
        </button>
        {isTest ? <Badge variant="outline">Test set</Badge> : null}
      </span>
      <span className="flex min-w-0 items-center gap-x-2">
        <SourceMark origin={origin} />
        {/* On a phone the score and city columns are hidden, so they sit under the name. */}
        <span className="truncate text-caption text-muted-foreground sm:hidden">
          {city ? `Score ${points}, ${city}` : `Score ${points}`}
        </span>
      </span>
    </span>
  )
}
