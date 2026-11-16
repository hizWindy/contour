/**
 * Meetings' controls (PLAN-V17 "The screens", part 5, and PLAN-V18 T2-3): Upcoming or Past, whose
 * meetings (All, My meetings, My team), the search, and Sync at the right end. The two choices are
 * `Segmented`: the highlight slides under the new pick. Each one changes the address, so Back and a
 * link keep the view.
 *
 * - **Whose meetings:** All is the default, so nobody opens an empty page. "My team" is left out
 *   when HubSpot has no teams (unless the address asks for it, so the choice in use always shows),
 *   and the whole choice is left out while sign-in is off, when there is no "me".
 * - The search finds a meeting by its company, its title or date words ("vitera 26 nov"). The
 *   server reads them, in plain code. It goes 250ms after the last key, so one request goes out per
 *   pause (DESIGN.md "Speed").
 */
import { Search } from 'lucide-react'
import { useEffect, useEffectEvent, useState } from 'react'
import type { MeetingWho } from '@/api/hooks/meetings'
import type { MeetingWhen } from '@/api/types'
import { Segmented, type SegmentedOption } from '@/components/motion'
import { Input } from '@/components/ui/input'
import { useDebounced } from '@/hooks/useDebounced'
import type { MeetingsView } from './params'
import { SyncButton } from './sync'
import type { MeetingsSync } from './use-sync'
import { PAST, SEARCH_LABEL, SEARCH_PLACEHOLDER, UPCOMING, WHEN_LABEL, WHO_LABEL } from './words'

/** Typed searches wait this long after the last key (DESIGN.md "Speed"). */
export const SEARCH_SETTLE_MS = 250

const WHEN_OPTIONS: readonly SegmentedOption<MeetingWhen>[] = [
  { value: 'upcoming', label: UPCOMING },
  { value: 'past', label: PAST },
]

function MeetingSearch({ value, onSettle }: { value: string; onSettle: (q: string) => void }) {
  const [text, setText] = useState(value)
  // The address changed by itself (Back, a link): the box follows it.
  const [outside, setOutside] = useState(value)
  if (value !== outside) {
    setOutside(value)
    setText(value)
  }
  const settled = useDebounced(text, SEARCH_SETTLE_MS)
  const settle = useEffectEvent((next: string) => {
    if (next !== value) onSettle(next)
  })
  useEffect(() => {
    settle(settled)
  }, [settled])
  return (
    <div className="relative w-72 max-sm:w-full">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        aria-label={SEARCH_LABEL}
        placeholder={SEARCH_PLACEHOLDER}
        // 16px text on a touch screen or a phone, so an iPhone doesn't zoom in on focus.
        className="pl-8 touch:pl-9 touch:text-body max-sm:text-body"
        value={text}
        maxLength={200}
        onChange={(event) => {
          setText(event.target.value)
        }}
      />
    </div>
  )
}

export interface MeetingsToolbarProps {
  view: MeetingsView
  onChange: (changes: Partial<MeetingsView>) => void
  /** The choices of whose meetings, or null to leave the choice out (sign-in off). */
  who: readonly SegmentedOption<MeetingWho>[] | null
  /** Sync, at the right end. Left out of a toolbar that has none. */
  sync?: MeetingsSync
}

export function MeetingsToolbar({ view, onChange, who, sync }: MeetingsToolbarProps) {
  return (
    <div data-slot="meetings-toolbar" className="flex flex-wrap items-center gap-3">
      <Segmented
        aria-label={WHEN_LABEL}
        options={WHEN_OPTIONS}
        value={view.when}
        onChange={(when) => {
          onChange({ when })
        }}
      />
      {who ? (
        <Segmented
          aria-label={WHO_LABEL}
          options={who}
          value={view.who}
          onChange={(next) => {
            onChange({ who: next })
          }}
        />
      ) : null}
      <MeetingSearch
        value={view.q}
        onSettle={(q) => {
          onChange({ q })
        }}
      />
      {sync ? <SyncButton sync={sync} className="max-sm:w-full sm:ml-auto" /> : null}
    </div>
  )
}
