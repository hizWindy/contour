/**
 * Meetings' controls (PLAN-V17 "The screens", part 5, and PLAN-V18 T2-3): Upcoming or Past, whose
 * meetings (All, My meetings, My team), the search, and Sync at the right end. The two choices are
 * `Segmented`: the highlight slides under the new pick. Each one changes the address, so Back and a
 * link keep the view.
 *
 * - **Whose meetings:** All is the default, so nobody opens an empty page. "My team" is left out
 *   when HubSpot has no teams (unless the address asks for it, so the choice in use always shows),
 *   and the whole choice is left out while sign-in is off, when there is no "me".
 * - **Owner** (Improvements 1, #5): a list of the people who own a meeting in the window, "Anyone"
 *   first. Picking one shows the meetings they own or are on, with sign-in on or off: where the
 *   three choices above can't say who "my" is, this can (the laptop with no sign-in). It narrows
 *   whichever of the three is picked. It shows when the server named at least one owner, and
 *   whenever the address already holds one, so the choice in use is never hidden.
 * - The search finds a meeting by its company, its title or date words ("vitera 26 nov"). The
 *   server reads them, in plain code. It goes 250ms after the last key, so one request goes out per
 *   pause (DESIGN.md "Speed").
 */
import { Search } from 'lucide-react'
import { useEffect, useEffectEvent, useState } from 'react'
import type { MeetingOwner, MeetingWhen, MeetingWho } from '@/api/types'
import { Segmented, type SegmentedOption } from '@/components/motion'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useDebounced } from '@/hooks/useDebounced'
import type { MeetingsView } from './params'
import { SyncButton } from './sync'
import type { MeetingsSync } from './use-sync'
import {
  ANYONE,
  OWNER_LABEL,
  OWNER_UNKNOWN,
  PAST,
  SEARCH_LABEL,
  SEARCH_PLACEHOLDER,
  UPCOMING,
  WHEN_LABEL,
  WHO_LABEL,
} from './words'

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

/** The select's value for "Anyone": a select item can't have an empty value. */
const ANYONE_VALUE = 'anyone'

/**
 * The Owner filter. The closed select reads "Owner: Alex Sample", so it says what it is even when
 * it is set. An owner the list no longer offers (an old link) still shows, as "This person".
 */
function OwnerSelect({
  owners,
  value,
  onChange,
}: {
  owners: readonly MeetingOwner[]
  value: string | null
  onChange: (owner: string | null) => void
}) {
  const known = owners.find((owner) => owner.id === value)
  const choices =
    value !== null && !known ? [...owners, { id: value, name: OWNER_UNKNOWN }] : owners
  const name = value === null ? ANYONE : (known?.name ?? OWNER_UNKNOWN)
  return (
    <Select
      value={value ?? ANYONE_VALUE}
      onValueChange={(next) => {
        onChange(next === ANYONE_VALUE ? null : next)
      }}
    >
      <SelectTrigger aria-label={OWNER_LABEL} className="w-52 max-sm:w-full">
        <SelectValue>{`${OWNER_LABEL}: ${name}`}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANYONE_VALUE}>{ANYONE}</SelectItem>
        {choices.map((owner) => (
          <SelectItem key={owner.id} value={owner.id}>
            {owner.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export interface MeetingsToolbarProps {
  view: MeetingsView
  onChange: (changes: Partial<MeetingsView>) => void
  /** The choices of whose meetings, or null to leave the choice out (sign-in off). */
  who: readonly SegmentedOption<MeetingWho>[] | null
  /** The people who own a meeting here, for the Owner filter. None: it is left out (until chosen). */
  owners?: readonly MeetingOwner[]
  /** Sync, at the right end. Left out of a toolbar that has none. */
  sync?: MeetingsSync
}

export function MeetingsToolbar({ view, onChange, who, owners = [], sync }: MeetingsToolbarProps) {
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
      {owners.length > 0 || view.owner !== null ? (
        <OwnerSelect
          owners={owners}
          value={view.owner}
          onChange={(owner) => {
            onChange({ owner })
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
