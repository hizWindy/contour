/**
 * Meetings' controls (PLAN-V17 "The screens", part 5): Upcoming or Past (`Segmented`, its
 * highlight slides), the search, and the switch for the team's meetings. Each one changes the
 * address, so Back and a link keep the view.
 *
 * The search finds a meeting by its company, its title or date words ("vitera 26 nov"). The server
 * reads them, in plain code. It goes 250ms after the last key, so one request goes out per pause
 * (DESIGN.md "Speed").
 */
import { Search } from 'lucide-react'
import { useEffect, useEffectEvent, useId, useState } from 'react'
import type { MeetingWhen } from '@/api/v17'
import { Segmented, type SegmentedOption } from '@/components/motion'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useDebounced } from '@/hooks/useDebounced'
import type { MeetingsView } from './params'
import { PAST, SEARCH_LABEL, SEARCH_PLACEHOLDER, TEAM_SWITCH, UPCOMING, WHEN_LABEL } from './words'

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

export function MeetingsToolbar({
  view,
  onChange,
}: {
  view: MeetingsView
  onChange: (changes: Partial<MeetingsView>) => void
}) {
  const teamId = useId()
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
      <MeetingSearch
        value={view.q}
        onSettle={(q) => {
          onChange({ q })
        }}
      />
      <label
        htmlFor={teamId}
        className="flex items-center gap-2 text-ui text-foreground touch:min-h-11 sm:ml-auto"
      >
        <Switch
          id={teamId}
          checked={view.team}
          onCheckedChange={(team) => {
            onChange({ team })
          }}
        />
        {TEAM_SWITCH}
      </label>
    </div>
  )
}
