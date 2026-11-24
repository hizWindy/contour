/**
 * The parts of the Company cell: the name with its marks, and the tick boxes. A tick box stops the
 * row's own click, which would open the lead.
 *
 * Two pages tick leads: the review page (PLAN-V9 C3), whose box for the whole page is in its bar,
 * and Results for the bulk add to HubSpot (PLAN-V27 T3-2), whose box is in the Company header
 * ("Select all on this page"). There a lead already sent can't be ticked, and says why.
 */
import { useContext } from 'react'
import type { LeadRow } from '@/api/types'
import { SourceMark } from '@/components/source-mark'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { TickContext } from './tick-context'

/** The tick boxes: which leads are ticked, and how to change that. */
export interface Tick {
  selected: ReadonlySet<string>
  /** The page's leads that can be ticked, for the box that ticks the whole page. */
  pageIds: readonly string[]
  onToggle: (id: string, on: boolean) => void
  onTogglePage: (on: boolean) => void
  /**
   * The bulk add to HubSpot (PLAN-V27 T3-2): the boxes say "Select", the box for the whole page
   * sits in the Company header, and a lead already sent can't be ticked.
   */
  forSending?: boolean
}

/** The words of the boxes, for the review page and for the bulk add. */
function tickWords(tick: Tick) {
  return tick.forSending
    ? {
        page: 'Select all on this page',
        row: (name: string) => `Select ${name}`,
        sent: (name: string) => `${name} was sent to HubSpot already`,
      }
    : {
        page: 'Tick every lead on this page',
        row: (name: string) => `Tick ${name}`,
        sent: (name: string) => `Tick ${name}`,
      }
}

/** Stops the row's own click (which opens the lead) when the tick box is clicked. */
function stop(event: { stopPropagation: () => void }): void {
  event.stopPropagation()
}

export function PageTick({ tick, label = tickWords(tick).page }: { tick: Tick; label?: string }) {
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

/** The bulk add's box for the whole page, in the Company header. The ticks come from context. */
export function HeaderTick() {
  const tick = useContext(TickContext)
  return tick ? <PageTick tick={tick} /> : null
}

/** A row's box. The ticks come from context, so the box keeps its focus as it is ticked. */
export function RowTick({
  id,
  name,
  sent = false,
}: {
  id: string
  name: string
  /** The lead was sent to HubSpot: for the bulk add it can't be ticked, and says why. */
  sent?: boolean
}) {
  const tick = useContext(TickContext)
  if (!tick) return null
  const words = tickWords(tick)
  const locked = Boolean(tick.forSending) && sent
  return (
    <span className="pt-0.5" onClick={stop} onKeyDown={stop}>
      <Checkbox
        aria-label={locked ? words.sent(name) : words.row(name)}
        title={locked ? words.sent(name) : undefined}
        disabled={locked}
        checked={!locked && tick.selected.has(id)}
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
